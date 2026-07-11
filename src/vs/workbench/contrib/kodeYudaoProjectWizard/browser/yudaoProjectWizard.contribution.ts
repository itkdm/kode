/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/yudaoProjectWizard.css';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { YudaoProjectWizardEditor } from './yudaoProjectWizardEditor.js';
import { YudaoProjectWizardInput } from './yudaoProjectWizardInput.js';

export const OPEN_YUDAO_PROJECT_WIZARD_COMMAND_ID = 'kode.yudao.createProject';

// Map the wizard input to the EditorPane that renders the page.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		YudaoProjectWizardEditor,
		YudaoProjectWizardEditor.ID,
		localize('kodeYudaoProjectWizardEditor', "Create Yudao Project")
	),
	[
		new SyncDescriptor(YudaoProjectWizardInput)
	]
);

// The wizard has no complex restorable state; restore the singleton input.
class YudaoProjectWizardInputSerializer implements IEditorSerializer {
	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof YudaoProjectWizardInput;
	}

	serialize(editorInput: EditorInput): string {
		return '';
	}

	deserialize(): EditorInput {
		return YudaoProjectWizardInput.instance;
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory)
	.registerEditorSerializer(YudaoProjectWizardInput.ID, YudaoProjectWizardInputSerializer);

// Expose a command so the welcome page, command palette, and future entries can open the wizard.
registerAction2(class OpenYudaoProjectWizardAction extends Action2 {
	constructor() {
		super({
			id: OPEN_YUDAO_PROJECT_WIZARD_COMMAND_ID,
			title: localize2('kodeYudaoProjectWizard.open', "Create Yudao Project"),
			category: Categories.File,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		await editorService.openEditor(YudaoProjectWizardInput.instance, {
			pinned: true,
			revealIfOpened: true,
		});
	}
});
