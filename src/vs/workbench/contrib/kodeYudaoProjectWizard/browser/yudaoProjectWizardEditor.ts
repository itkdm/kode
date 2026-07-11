/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, Dimension } from '../../../../base/browser/dom.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILocalGitService } from '../../../../platform/git/common/localGitService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
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

type BranchCache = Record<string, IBranchCacheEntry>;

// EditorPane that renders the wizard form, refreshes branches, clones repos, and opens the workspace.
export class YudaoProjectWizardEditor extends EditorPane {

	static readonly ID = 'workbench.editor.kodeYudaoProjectWizard';

	private container: HTMLElement | undefined;
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
		projectName: HTMLInputElement;
		sourceProvider: HTMLSelectElement;
		parentPath: HTMLInputElement;
		backend: HTMLSelectElement;
		backendBranch: HTMLSelectElement;
		frontend: HTMLSelectElement;
		frontendBranch: HTMLSelectElement;
		modules: HTMLElement;
		createButton: HTMLButtonElement;
		openButton: HTMLButtonElement;
		error: HTMLElement;
		log: HTMLElement;
		status: HTMLElement;
		branchStatus: HTMLElement;
		summary: HTMLElement;
	} | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
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

		clearNode(this.container);
		const shell = append(this.container, $('.wizard-shell'));
		const header = append(shell, $('.wizard-header'));
		const headerText = append(header, $('div'));
		append(headerText, $('h1', {}, localize('kodeYudaoWizard.title', "Create Yudao Project")));
		append(headerText, $('p.subtitle', {}, localize('kodeYudaoWizard.subtitle', "Choose backend and frontend stacks, pick a parent folder, then Kode will clone the selected Yudao sources into a clean workspace.")));
		const status = append(header, $('div.status-pill', {}, localize('kodeYudaoWizard.statusReady', "Ready")));

		const grid = append(shell, $('.wizard-grid'));
		const form = append(grid, $('div'));
		const side = append(grid, $('div'));

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
		const parentPath = append(pathRow, $('input', { readonly: 'true', value: this.state.parentUri?.fsPath ?? '' })) as HTMLInputElement;
		const browseButton = append(pathRow, $('button.secondary', { type: 'button' }, localize('kodeYudaoWizard.browse', "Browse..."))) as HTMLButtonElement;

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

		const moduleSection = append(form, $('.section'));
		append(moduleSection, $('h2', {}, localize('kodeYudaoWizard.modulesSection', "Backend modules for Kode context")));
		const modules = append(moduleSection, $('.module-list'));

		const summary = append(side, $('.summary'));
		append(summary, $('h2', {}, localize('kodeYudaoWizard.summary', "Summary")));
		const summaryBody = append(summary, $('dl'));
		const actions = append(side, $('.actions'));
		const createButton = append(actions, $('button', { type: 'button' }, localize('kodeYudaoWizard.create', "Clone and Open"))) as HTMLButtonElement;
		const openButton = append(actions, $('button.secondary', { type: 'button' }, localize('kodeYudaoWizard.openFolder', "Open Folder"))) as HTMLButtonElement;
		const error = append(side, $('.error'));
		const log = append(side, $('.log', {}, localize('kodeYudaoWizard.logEmpty', "Clone log will appear here.")));

		this.elements = { projectName, sourceProvider, parentPath, backend, backendBranch, frontend, frontendBranch, modules, createButton, openButton, error, log, status, branchStatus, summary: summaryBody };
		this.resolveDefaultParentFolder();
		this.refreshDynamicControls();
		// Built-in branches keep the page usable while real remote branches refresh in the background.
		this.refreshRemoteBranches();

		projectName.addEventListener('input', () => {
			this.state.projectName = projectName.value.trim();
			this.refreshSummary();
		});
		sourceProvider.addEventListener('change', () => {
			this.state.sourceProvider = sourceProvider.value as YudaoSourceProvider;
			this.ensureSelectedBranchesExist();
			this.refreshDynamicControls();
			this.refreshRemoteBranches();
		});
		backend.addEventListener('change', () => {
			this.state.backend = backend.value as YudaoBackendKind;
			this.state.backendBranch = this.getBackendBranches()[0] ?? '';
			this.refreshDynamicControls();
			this.refreshRemoteBranches();
		});
		backendBranch.addEventListener('change', () => {
			this.state.backendBranch = backendBranch.value;
			this.refreshSummary();
		});
		frontend.addEventListener('change', () => {
			this.state.frontend = frontend.value as YudaoFrontendKind;
			this.state.frontendBranch = this.getFrontendBranches()[0] ?? '';
			this.refreshDynamicControls();
			this.refreshRemoteBranches();
		});
		frontendBranch.addEventListener('change', () => {
			this.state.frontendBranch = frontendBranch.value;
			this.refreshSummary();
		});
		browseButton.addEventListener('click', () => this.chooseParentFolder());
		createButton.addEventListener('click', () => this.createProject());
		openButton.addEventListener('click', () => this.openProjectRoot());
	}

	private createInput(parent: HTMLElement, labelText: string, value: string): HTMLInputElement {
		const label = append(parent, $('label'));
		label.append(labelText);
		return append(label, $('input', { value })) as HTMLInputElement;
	}

	private createSelect(parent: HTMLElement, labelText: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement {
		const label = append(parent, $('label'));
		label.append(labelText);
		const select = append(label, $('select')) as HTMLSelectElement;
		this.setSelectOptions(select, options, value);
		return select;
	}

	private setSelectOptions(select: HTMLSelectElement, options: readonly (readonly [string, string])[], value: string): void {
		clearNode(select);
		for (const [optionValue, label] of options) {
			append(select, $('option', { value: optionValue }, label));
		}
		select.value = value;
	}

	private refreshDynamicControls(): void {
		if (!this.elements) {
			return;
		}
		// Branch pickers depend on selected stack and source provider, so rebuild them from state.
		this.setSelectOptions(this.elements.backendBranch, this.getBackendBranches().map(branch => [branch, branch]), this.state.backendBranch);
		this.elements.backendBranch.disabled = this.state.backend === 'none';
		this.setSelectOptions(this.elements.frontendBranch, this.getFrontendBranches().map(branch => [branch, branch]), this.state.frontendBranch);
		this.elements.frontendBranch.disabled = this.state.frontend === 'none';
		clearNode(this.elements.modules);
		this.ensureRequiredModulesSelected();
		// Module checkboxes come from presets; required modules stay checked and disabled.
		for (const module of yudaoModulePresets) {
			const label = append(this.elements.modules, $('label.module-option'));
			const checkbox = append(label, $('input', { type: 'checkbox' })) as HTMLInputElement;
			checkbox.checked = this.state.modules.has(module.id);
			checkbox.disabled = module.required === true;
			label.append(module.label);
			if (module.required) {
				append(label, $('span.required-badge', {}, localize('kodeYudaoWizard.requiredModule', "Required")));
			}
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.state.modules.add(module.id);
				} else {
					if (!module.required) {
						this.state.modules.delete(module.id);
					}
				}
				this.ensureRequiredModulesSelected();
				this.refreshSummary();
			});
		}
		this.refreshSummary();
	}

	private refreshSummary(): void {
		if (!this.elements) {
			return;
		}
		this.ensureRequiredModulesSelected();
		clearNode(this.elements.summary);
		const rows: [string, string][] = [
			[localize('kodeYudaoWizard.summaryRoot', "Root"), this.getProjectRootUri()?.fsPath ?? localize('kodeYudaoWizard.notSelected', "Not selected")],
			[localize('kodeYudaoWizard.summaryBackend', "Backend"), this.state.backend === 'none' ? 'None' : `${yudaoBackendPresets[this.state.backend].label} / ${this.state.backendBranch}`],
			[localize('kodeYudaoWizard.summaryFrontend', "Frontend"), this.state.frontend === 'none' ? 'None' : `${yudaoFrontendPresets[this.state.frontend].label} / ${this.state.frontendBranch}`],
			[localize('kodeYudaoWizard.summarySource', "Source"), this.state.sourceProvider],
			[localize('kodeYudaoWizard.summaryModules', "Modules"), [...this.state.modules].join(', ') || 'None'],
		];
		for (const [key, value] of rows) {
			append(this.elements.summary, $('dt', {}, key));
			append(this.elements.summary, $('dd', {}, value));
		}
		this.elements.createButton.disabled = this.running;
		this.elements.openButton.disabled = !this.state.parentUri;
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
			this.refreshSummary();
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
		const validationError = this.validate();
		if (validationError) {
			this.elements.error.textContent = validationError;
			return;
		}

		const projectRoot = this.getProjectRootUri()!;
		if (await this.fileService.exists(projectRoot)) {
			this.elements.error.textContent = localize('kodeYudaoWizard.projectExists', "The project folder already exists. Choose a different project name.");
			return;
		}

		this.running = true;
		this.elements.createButton.disabled = true;
		this.elements.status.textContent = localize('kodeYudaoWizard.statusCloning', "Cloning...");
		this.elements.log.textContent = '';

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
		} finally {
			this.running = false;
			this.refreshSummary();
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

	private async openProjectRoot(): Promise<void> {
		const projectRoot = this.getProjectRootUri();
		if (projectRoot) {
			await this.hostService.openWindow([{ folderUri: projectRoot }], { forceReuseWindow: true });
		}
	}

	private appendLog(message: string): void {
		if (!this.elements) {
			return;
		}
		this.elements.log.textContent += `${message}\n`;
		this.elements.log.scrollTop = this.elements.log.scrollHeight;
	}

	override clearInput(): void {
		if (this.container) {
			clearNode(this.container);
		}
		this.elements = undefined;
		super.clearInput();
	}
}
