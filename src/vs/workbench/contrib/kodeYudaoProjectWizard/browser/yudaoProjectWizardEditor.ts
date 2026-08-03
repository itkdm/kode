/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, Dimension } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { ISelectOptionItem, SelectBox } from '../../../../base/browser/ui/selectBox/selectBox.js';
import { Checkbox } from '../../../../base/browser/ui/toggle/toggle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILocalGitService } from '../../../../platform/git/common/localGitService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { defaultButtonStyles, defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IYudaoProjectPreset, YudaoBackendKind, YudaoFrontendKind, YudaoSourceProvider, yudaoBackendPresets, yudaoFrontendPresetOrder, yudaoFrontendPresets, yudaoModulePresets, yudaoRequiredModuleIds } from '../common/yudaoProjectPresets.js';
import { YudaoProjectWizardInput } from './yudaoProjectWizardInput.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

const BRANCH_CACHE_STORAGE_KEY = 'kode.yudaoProjectWizard.remoteBranches';
const BRANCH_CACHE_TTL = 24 * 60 * 60 * 1000;
const LAST_PARENT_FOLDER_STORAGE_KEY = 'kode.yudaoProjectWizard.lastParentFolder';

interface IWizardState {
	sourceProvider: YudaoSourceProvider;
	projectName: string;
	parentUri: URI | undefined;
	backend: YudaoBackendKind;
	backendBranch: string;
	frontend: YudaoFrontendKind;
	frontendBranch: string;
	modules: Set<string>;
}

interface IBranchCacheEntry {
	readonly timestamp: number;
	readonly branches: string[];
}

interface IWizardSelect {
	readonly selectBox: SelectBox;
	values: string[];
}

type BranchCache = Record<string, IBranchCacheEntry>;

// EditorPane that renders the wizard form, refreshes branches, clones repos, and opens the workspace.
export class YudaoProjectWizardEditor extends EditorPane {

	static readonly ID = 'workbench.editor.kodeYudaoProjectWizard';

	private container: HTMLElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());
	private readonly moduleDisposables = this._register(new DisposableStore());
	private running = false;
	private refreshGeneration = 0;
	// Runtime branch results; fall back to built-in preset branches when refresh fails.
	private readonly resolvedBranches = new Map<string, string[]>();
	// Single state source for form values; controls update this first, then refresh derived UI.
	private readonly state: IWizardState = {
		sourceProvider: 'auto',
		projectName: 'my-yudao',
		parentUri: undefined,
		backend: 'boot',
		backendBranch: 'master-jdk17',
		frontend: 'adminVue3',
		frontendBranch: 'master',
		modules: new Set(yudaoRequiredModuleIds),
	};

	private elements: {
		projectName: InputBox;
		sourceProvider: IWizardSelect;
		parentPath: InputBox;
		projectPath: HTMLElement;
		backend: IWizardSelect;
		backendBranch: IWizardSelect;
		frontend: IWizardSelect;
		frontendBranch: IWizardSelect;
		modules: HTMLElement;
		createButton: Button;
		error: HTMLElement;
		log: HTMLElement;
		logToggle: Button;
		status: HTMLElement;
		branchStatus: HTMLElement;
		feedback: HTMLElement;
	} | undefined;
	private logVisible = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@ILocalGitService private readonly localGitService: ILocalGitService,
		@IHostService private readonly hostService: IHostService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(YudaoProjectWizardEditor.ID, group, telemetryService, themeService, storageService);
		// Prefer the last chosen parent folder; first-time defaults are resolved later.
		this.state.parentUri = this.readLastParentFolder();
	}

	protected override createEditor(parent: HTMLElement): void {
		// Mount only the root container here; render owns the full page structure.
		this.container = append(parent, $('.yudao-project-wizard'));
		this.render();
	}

	override layout(dimension: Dimension): void {
		// The wizard uses normal document flow inside the editor pane.
	}

	override async setInput(input: YudaoProjectWizardInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.render();
	}

	private render(): void {
		if (!this.container) {
			return;
		}

		this.renderDisposables.clear();
		this.moduleDisposables.clear();
		clearNode(this.container);
		const shell = append(this.container, $('.wizard-shell'));
		const header = append(shell, $('.wizard-header'));
		const headerText = append(header, $('div'));
		append(headerText, $('h1', {}, localize('kodeYudaoWizard.title', "Create Yudao Project")));
		append(headerText, $('p.subtitle', {}, localize('kodeYudaoWizard.subtitle', "Choose backend and frontend stacks, pick a parent folder, then Kode will clone the selected Yudao sources into a clean workspace.")));

		const form = append(shell, $('.wizard-form'));

		const projectSection = append(form, $('.section'));
		append(projectSection, $('h2', {}, localize('kodeYudaoWizard.projectSection', "Project")));
		const projectFields = append(projectSection, $('.field-grid'));
		const projectName = this.createInput(projectFields, localize('kodeYudaoWizard.projectName', "Project name"), this.state.projectName);
		const sourceProvider = this.createSelect(projectFields, localize('kodeYudaoWizard.sourceProvider', "Source provider"), [
			['auto', 'Auto: Gitee first, GitHub fallback'],
			['gitee', 'Gitee'],
			['github', 'GitHub'],
		], this.state.sourceProvider);
		const pathSection = append(projectSection, $('label'));
		pathSection.append(localize('kodeYudaoWizard.parentFolder', "Parent folder"));
		const pathRow = append(pathSection, $('.path-row'));
		const parentPath = this.createBareInput(pathRow, localize('kodeYudaoWizard.parentFolder', "Parent folder"), this.state.parentUri?.fsPath ?? '');
		parentPath.inputElement.readOnly = true;
		const browseButton = this.createButton(pathRow, localize('kodeYudaoWizard.browse', "Browse..."), true);
		const projectPath = append(projectSection, $('div.project-path-preview'));

		const stackSection = append(form, $('.section'));
		append(stackSection, $('h2', {}, localize('kodeYudaoWizard.stackSection', "Stacks")));
		const stackFields = append(stackSection, $('.field-grid'));
		const backend = this.createSelect(stackFields, localize('kodeYudaoWizard.backend', "Backend"), [
			['none', 'Do not create backend'],
			['boot', yudaoBackendPresets.boot.label],
			['cloud', yudaoBackendPresets.cloud.label],
		], this.state.backend);
		const backendBranch = this.createSelect(stackFields, localize('kodeYudaoWizard.backendBranch', "Backend branch"), [], this.state.backendBranch);
		const frontend = this.createSelect(stackFields, localize('kodeYudaoWizard.frontend', "Frontend project"), [
			['none', 'Do not create frontend'],
			...yudaoFrontendPresetOrder.map(kind => [kind, `${yudaoFrontendPresets[kind].label} - ${yudaoFrontendPresets[kind].description}`] as const),
		], this.state.frontend);
		const frontendBranch = this.createSelect(stackFields, localize('kodeYudaoWizard.frontendBranch', "Frontend branch"), [], this.state.frontendBranch);
		const branchStatus = append(stackSection, $('div.branch-status'));

		const advancedSection = append(form, $('details.advanced-section'));
		append(advancedSection, $('summary', {}, localize('kodeYudaoWizard.advancedOptions', "Advanced options")));
		const advancedBody = append(advancedSection, $('.advanced-body'));
		append(advancedBody, $('h2', {}, localize('kodeYudaoWizard.modulesSection', "Kode context modules")));
		const modules = append(advancedBody, $('.module-list'));

		const actions = append(form, $('.actions'));
		const createButton = this.createButton(actions, localize('kodeYudaoWizard.create', "Clone and Open"));
		const feedback = append(form, $('.feedback'));
		const status = append(feedback, $('div.operation-status'));
		const error = append(feedback, $('.error'));
		const logToggle = this.createButton(feedback, localize('kodeYudaoWizard.showLog', "Show clone log"), true);
		const log = append(feedback, $('.log'));

		this.elements = { projectName, sourceProvider, parentPath, projectPath, backend, backendBranch, frontend, frontendBranch, modules, createButton, error, log, logToggle, status, branchStatus, feedback };
		this.resolveDefaultParentFolder();
		this.refreshDynamicControls();
		// Built-in branches keep the page usable while real remote branches refresh in the background.
		this.refreshRemoteBranches();

		this.renderDisposables.add(projectName.onDidChange(value => {
			this.state.projectName = value.trim();
			this.refreshDerivedState();
		}));
		this.renderDisposables.add(sourceProvider.selectBox.onDidSelect(({ index }) => {
			const selected = sourceProvider.values[index] as YudaoSourceProvider | undefined;
			if (!selected) {
				return;
			}
			this.state.sourceProvider = selected;
			this.ensureSelectedBranchesExist();
			this.refreshDynamicControls();
			this.refreshRemoteBranches();
		}));
		this.renderDisposables.add(backend.selectBox.onDidSelect(({ index }) => {
			const selected = backend.values[index] as YudaoBackendKind | undefined;
			if (!selected) {
				return;
			}
			this.state.backend = selected;
			this.state.backendBranch = this.getBackendBranches()[0] ?? '';
			this.refreshDynamicControls();
			this.refreshRemoteBranches();
		}));
		this.renderDisposables.add(backendBranch.selectBox.onDidSelect(({ index }) => {
			this.state.backendBranch = backendBranch.values[index] ?? '';
			this.refreshDerivedState();
		}));
		this.renderDisposables.add(frontend.selectBox.onDidSelect(({ index }) => {
			const selected = frontend.values[index] as YudaoFrontendKind | undefined;
			if (!selected) {
				return;
			}
			this.state.frontend = selected;
			this.state.frontendBranch = this.getFrontendBranches()[0] ?? '';
			this.refreshDynamicControls();
			this.refreshRemoteBranches();
		}));
		this.renderDisposables.add(frontendBranch.selectBox.onDidSelect(({ index }) => {
			this.state.frontendBranch = frontendBranch.values[index] ?? '';
			this.refreshDerivedState();
		}));
		this.renderDisposables.add(browseButton.onDidClick(() => this.chooseParentFolder()));
		this.renderDisposables.add(createButton.onDidClick(() => this.createProject()));
		this.renderDisposables.add(logToggle.onDidClick(() => {
			this.logVisible = !this.logVisible;
			this.updateFeedbackVisibility();
		}));
	}

	private createInput(parent: HTMLElement, labelText: string, value: string): InputBox {
		const label = append(parent, $('label'));
		label.append(labelText);
		return this.createBareInput(label, labelText, value);
	}

	private createBareInput(parent: HTMLElement, labelText: string, value: string): InputBox {
		const container = append(parent, $('.input-control'));
		const input = this.renderDisposables.add(new InputBox(container, this.contextViewService, {
			ariaLabel: labelText,
			inputBoxStyles: defaultInputBoxStyles,
		}));
		input.value = value;
		return input;
	}

	private createButton(parent: HTMLElement, labelText: string, secondary = false): Button {
		const button = this.renderDisposables.add(new Button(parent, { ...defaultButtonStyles, secondary }));
		button.label = labelText;
		return button;
	}

	private createSelect(parent: HTMLElement, labelText: string, options: readonly (readonly [string, string])[], value: string): IWizardSelect {
		const label = append(parent, $('label'));
		label.append(labelText);
		const container = append(label, $('.select-control'));
		const selectBox = this.renderDisposables.add(new SelectBox([], 0, this.contextViewService, defaultSelectBoxStyles, {
			ariaLabel: labelText,
			optionsAsChildren: true,
			useCustomDrawn: true,
		}));
		selectBox.render(container);
		const select: IWizardSelect = { selectBox, values: [] };
		this.setSelectOptions(select, options, value);
		return select;
	}

	private setSelectOptions(select: IWizardSelect, options: readonly (readonly [string, string])[], value: string): void {
		select.values = options.map(([optionValue]) => optionValue);
		const selectedIndex = Math.max(0, select.values.indexOf(value));
		const selectOptions: ISelectOptionItem[] = options.map(([, label]) => ({ text: label }));
		select.selectBox.setOptions(selectOptions, selectedIndex);
	}

	private refreshDynamicControls(): void {
		if (!this.elements) {
			return;
		}
		// Branch pickers depend on selected stack and source provider, so rebuild them from state.
		this.setSelectOptions(this.elements.backendBranch, this.getBackendBranches().map(branch => [branch, branch]), this.state.backendBranch);
		this.elements.backendBranch.selectBox.setEnabled(this.state.backend !== 'none');
		this.setSelectOptions(this.elements.frontendBranch, this.getFrontendBranches().map(branch => [branch, branch]), this.state.frontendBranch);
		this.elements.frontendBranch.selectBox.setEnabled(this.state.frontend !== 'none');
		this.moduleDisposables.clear();
		clearNode(this.elements.modules);
		this.ensureRequiredModulesSelected();
		// Module checkboxes come from presets; required modules stay checked and disabled.
		for (const module of yudaoModulePresets) {
			const label = append(this.elements.modules, $('label.module-option'));
			const checkbox = this.moduleDisposables.add(new Checkbox(module.label, this.state.modules.has(module.id), { ...defaultCheckboxStyles, size: 15 }));
			label.append(checkbox.domNode);
			append(label, $('span.module-label', {}, module.label));
			checkbox.checked = this.state.modules.has(module.id);
			if (module.required) {
				checkbox.disable();
				append(label, $('span.required-badge', {}, localize('kodeYudaoWizard.requiredModule', "Required")));
			}
			this.moduleDisposables.add(checkbox.onChange(() => {
				if (checkbox.checked) {
					this.state.modules.add(module.id);
				} else {
					if (!module.required) {
						this.state.modules.delete(module.id);
					}
				}
				this.ensureRequiredModulesSelected();
				this.refreshDerivedState();
			}));
		}
		this.refreshDerivedState();
	}

	private refreshDerivedState(): void {
		if (!this.elements) {
			return;
		}
		this.ensureRequiredModulesSelected();
		const projectRoot = this.getProjectRootUri();
		this.elements.projectPath.textContent = projectRoot
			? localize('kodeYudaoWizard.projectPathPreview', "Will create: {0}", projectRoot.fsPath)
			: localize('kodeYudaoWizard.projectPathPending', "Choose a parent folder to set the project location.");
		this.elements.createButton.enabled = !this.running;
		this.updateFeedbackVisibility();
	}

	private updateFeedbackVisibility(): void {
		if (!this.elements) {
			return;
		}

		const hasStatus = this.elements.status.textContent !== '';
		const hasError = this.elements.error.textContent !== '';
		const hasLog = this.elements.log.textContent.trim() !== '';
		this.elements.feedback.hidden = !hasStatus && !hasError && !hasLog;
		this.elements.status.hidden = !hasStatus;
		this.elements.error.hidden = !hasError;
		this.elements.logToggle.element.hidden = !hasLog;
		this.elements.log.hidden = !hasLog || !this.logVisible;
		this.elements.logToggle.label = this.logVisible
			? localize('kodeYudaoWizard.hideLog', "Hide clone log")
			: localize('kodeYudaoWizard.showLog', "Show clone log");
	}

	private getBackendBranches(): string[] {
		return this.state.backend === 'none' ? [] : this.getBranchesForPreset(yudaoBackendPresets[this.state.backend]);
	}

	private getFrontendBranches(): string[] {
		return this.state.frontend === 'none' ? [] : this.getBranchesForPreset(yudaoFrontendPresets[this.state.frontend]);
	}

	private getBranchesForPreset(preset: IYudaoProjectPreset): string[] {
		const provider = this.getEffectiveSourceProvider();
		const cacheKey = this.getBranchCacheKey(provider, preset.mirrors[provider]);
		// Prefer runtime remote branches; use built-in branches as a safe fallback.
		return [...(this.resolvedBranches.get(cacheKey) ?? preset.branches[provider])];
	}

	private getEffectiveSourceProvider(): Exclude<YudaoSourceProvider, 'auto'> {
		// Auto prefers Gitee here; clone later falls back from Gitee to GitHub.
		return this.state.sourceProvider === 'github' ? 'github' : 'gitee';
	}

	private ensureSelectedBranchesExist(): void {
		const backendBranches = this.getBackendBranches();
		if (this.state.backend !== 'none' && !backendBranches.includes(this.state.backendBranch)) {
			this.state.backendBranch = backendBranches[0] ?? '';
		}

		const frontendBranches = this.getFrontendBranches();
		if (this.state.frontend !== 'none' && !frontendBranches.includes(this.state.frontendBranch)) {
			this.state.frontendBranch = frontendBranches[0] ?? '';
		}
	}

	private async refreshRemoteBranches(): Promise<void> {
		if (!this.elements) {
			return;
		}

		// Generation discards stale async results when the user changes selections quickly.
		const generation = ++this.refreshGeneration;
		const requests: Promise<void>[] = [];
		this.elements.branchStatus.textContent = '';

		if (this.state.backend !== 'none') {
			requests.push(this.refreshPresetBranches(yudaoBackendPresets[this.state.backend]));
		}
		if (this.state.frontend !== 'none') {
			requests.push(this.refreshPresetBranches(yudaoFrontendPresets[this.state.frontend]));
		}

		const results = await Promise.allSettled(requests);
		if (generation !== this.refreshGeneration || !this.elements) {
			return;
		}

		this.ensureSelectedBranchesExist();
		this.refreshDynamicControls();

		const failed = results.some(result => result.status === 'rejected');
		this.elements.branchStatus.textContent = failed
			? localize('kodeYudaoWizard.branchStatusFallback', "Could not refresh every remote. Built-in branches are still available.")
			: '';
	}

	private ensureRequiredModulesSelected(): void {
		for (const moduleId of yudaoRequiredModuleIds) {
			this.state.modules.add(moduleId);
		}
	}

	private async refreshPresetBranches(preset: IYudaoProjectPreset): Promise<void> {
		const provider = this.getEffectiveSourceProvider();
		const remoteUrl = preset.mirrors[provider];
		const cacheKey = this.getBranchCacheKey(provider, remoteUrl);
		const cached = this.getCachedBranches(cacheKey);
		if (cached) {
			this.resolvedBranches.set(cacheKey, cached);
		}

		try {
			// git ls-remote works before clone; successful results go to memory and 24h storage cache.
			const branches = await this.localGitService.listRemoteBranches(generateUuid(), remoteUrl);
			if (branches.length === 0) {
				throw new Error(localize('kodeYudaoWizard.noRemoteBranches', "The remote repository did not return any branches."));
			}
			this.resolvedBranches.set(cacheKey, branches);
			this.setCachedBranches(cacheKey, branches);
		} catch (error) {
			if (!cached) {
				throw error;
			}
		}
	}

	private getBranchCacheKey(provider: Exclude<YudaoSourceProvider, 'auto'>, remoteUrl: string): string {
		return `${provider}:${remoteUrl}`;
	}

	private getCachedBranches(cacheKey: string): string[] | undefined {
		const cache = this.readBranchCache();
		const entry = cache[cacheKey];
		if (!entry || Date.now() - entry.timestamp > BRANCH_CACHE_TTL || entry.branches.length === 0) {
			return undefined;
		}
		return entry.branches;
	}

	private setCachedBranches(cacheKey: string, branches: string[]): void {
		const cache = this.readBranchCache();
		cache[cacheKey] = { timestamp: Date.now(), branches };
		this.storageService.store(BRANCH_CACHE_STORAGE_KEY, JSON.stringify(cache), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private readBranchCache(): BranchCache {
		const raw = this.storageService.get(BRANCH_CACHE_STORAGE_KEY, StorageScope.APPLICATION, '{}');
		try {
			return JSON.parse(raw) as BranchCache;
		} catch {
			return {};
		}
	}

	private async chooseParentFolder(): Promise<void> {
		const result = await this.fileDialogService.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			defaultUri: this.state.parentUri,
			title: localize('kodeYudaoWizard.pickParentFolder', "Select the parent folder for the Yudao workspace"),
		});
		const folder = result?.[0];
		if (!folder || !this.elements) {
			return;
		}
		this.setParentFolder(folder);
	}

	private async resolveDefaultParentFolder(): Promise<void> {
		if (this.state.parentUri) {
			return;
		}
		try {
			// First use falls back to the platform default folder; manual choices are stored.
			this.setParentFolder(await this.fileDialogService.defaultFolderPath());
		} catch {
			// Keep the explicit validation message if the platform cannot provide a default path.
		}
	}

	private setParentFolder(folder: URI): void {
		this.state.parentUri = folder;
		this.storageService.store(LAST_PARENT_FOLDER_STORAGE_KEY, folder.toString(), StorageScope.APPLICATION, StorageTarget.USER);
		if (this.elements) {
			this.elements.parentPath.value = folder.fsPath;
			this.refreshDerivedState();
		}
	}

	private readLastParentFolder(): URI | undefined {
		const raw = this.storageService.get(LAST_PARENT_FOLDER_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return undefined;
		}
		try {
			return URI.parse(raw);
		} catch {
			return undefined;
		}
	}

	private getProjectRootUri(): URI | undefined {
		if (!this.state.parentUri || !this.state.projectName) {
			return undefined;
		}
		return URI.joinPath(this.state.parentUri, this.state.projectName);
	}

	private validate(): string | undefined {
		if (!/^[A-Za-z0-9_-]+$/.test(this.state.projectName)) {
			return localize('kodeYudaoWizard.invalidName', "Project name can only contain letters, numbers, hyphens, and underscores.");
		}
		if (!this.state.parentUri) {
			return localize('kodeYudaoWizard.noParent', "Choose a parent folder first.");
		}
		if (this.state.backend === 'none' && this.state.frontend === 'none') {
			return localize('kodeYudaoWizard.noStack', "Select at least one backend or frontend stack.");
		}
		return undefined;
	}

	private async createProject(): Promise<void> {
		if (!this.elements || this.running) {
			return;
		}
		// Re-read the input before creating so state matches the latest DOM value.
		this.state.projectName = this.elements.projectName.value.trim();
		this.elements.error.textContent = '';
		this.elements.status.textContent = '';
		this.elements.log.textContent = '';
		this.logVisible = false;
		const validationError = this.validate();
		if (validationError) {
			this.elements.error.textContent = validationError;
			this.updateFeedbackVisibility();
			return;
		}

		const projectRoot = this.getProjectRootUri()!;
		if (await this.fileService.exists(projectRoot)) {
			this.elements.error.textContent = localize('kodeYudaoWizard.projectExists', "The project folder already exists. Choose a different project name.");
			this.updateFeedbackVisibility();
			return;
		}

		this.running = true;
		this.logVisible = false;
		this.elements.createButton.enabled = false;
		this.elements.status.textContent = localize('kodeYudaoWizard.statusCloning', "Cloning...");
		this.updateFeedbackVisibility();

		try {
			await this.fileService.createFolder(projectRoot);
			// Clone selected repos, write Kode metadata, then reuse this window for the new workspace.
			await this.cloneSelectedProjects(projectRoot);
			await this.writeProjectMetadata(projectRoot);
			this.appendLog(localize('kodeYudaoWizard.done', "Done. Opening workspace..."));
			await this.hostService.openWindow([{ folderUri: projectRoot }], { forceReuseWindow: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.elements.error.textContent = message;
			this.notificationService.error(message);
			this.elements.status.textContent = localize('kodeYudaoWizard.statusFailed', "Failed");
			this.logVisible = true;
		} finally {
			this.running = false;
			this.refreshDerivedState();
		}
	}

	private async cloneSelectedProjects(projectRoot: URI): Promise<void> {
		if (this.state.backend !== 'none') {
			const preset = yudaoBackendPresets[this.state.backend];
			await this.cloneWithProviderFallback(preset.mirrors, this.state.backendBranch, URI.joinPath(projectRoot, 'yudao-backend').fsPath, 'backend');
		}
		if (this.state.frontend !== 'none') {
			const preset = yudaoFrontendPresets[this.state.frontend];
			await this.cloneWithProviderFallback(preset.mirrors, this.state.frontendBranch, URI.joinPath(projectRoot, preset.workspaceFolder).fsPath, 'frontend');
		}
	}

	private async cloneWithProviderFallback(mirrors: { gitee: string; github: string }, branch: string, targetPath: string, label: string): Promise<void> {
		const providers: Exclude<YudaoSourceProvider, 'auto'>[] = this.state.sourceProvider === 'auto' ? ['gitee', 'github'] : [this.state.sourceProvider];
		let lastError: unknown;
		for (const provider of providers) {
			const repo = mirrors[provider];
			try {
				// Auto tries Gitee first and then GitHub; explicit source selection tries only that source.
				this.appendLog(`git clone --branch ${branch} ${repo} ${targetPath}`);
				await this.localGitService.clone(generateUuid(), repo, targetPath, branch);
				this.appendLog(`${label}: cloned from ${provider}`);
				return;
			} catch (error) {
				lastError = error;
				this.appendLog(`${label}: ${provider} failed`);
			}
		}
		throw lastError instanceof Error ? lastError : new Error(localize('kodeYudaoWizard.cloneFailed', "Clone failed."));
	}

	private async writeProjectMetadata(projectRoot: URI): Promise<void> {
		this.ensureRequiredModulesSelected();
		const kodeDir = URI.joinPath(projectRoot, '.kode');
		await this.fileService.createFolder(kodeDir);
		// Metadata lets future Kode agents understand source, stacks, branches, and selected modules.
		const metadata = {
			projectName: this.state.projectName,
			createdAt: new Date().toISOString(),
			sourceProvider: this.state.sourceProvider,
			backend: this.state.backend === 'none' ? undefined : {
				kind: this.state.backend,
				branch: this.state.backendBranch,
				path: 'yudao-backend',
			},
			frontend: this.state.frontend === 'none' ? undefined : {
				kind: this.state.frontend,
				branch: this.state.frontendBranch,
				path: yudaoFrontendPresets[this.state.frontend].workspaceFolder,
			},
			modules: [...this.state.modules],
		};
		await this.fileService.writeFile(URI.joinPath(kodeDir, 'yudao-project.json'), VSBuffer.fromString(JSON.stringify(metadata, undefined, '\t')));
	}

	private appendLog(message: string): void {
		if (!this.elements) {
			return;
		}
		this.elements.log.textContent += `${message}\n`;
		this.elements.log.scrollTop = this.elements.log.scrollHeight;
		this.updateFeedbackVisibility();
	}

	override clearInput(): void {
		this.renderDisposables.clear();
		this.moduleDisposables.clear();
		if (this.container) {
			clearNode(this.container);
		}
		this.elements = undefined;
		super.clearInput();
	}
}
