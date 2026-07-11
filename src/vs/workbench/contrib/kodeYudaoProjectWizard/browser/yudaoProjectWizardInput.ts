/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

const yudaoProjectWizardIcon = FileAccess.asBrowserUri('vs/workbench/browser/parts/editor/media/letterpress.png');

// EditorInput describes which page to open; DOM rendering lives in YudaoProjectWizardEditor.
export class YudaoProjectWizardInput extends EditorInput {

	static readonly ID = 'workbench.input.kodeYudaoProjectWizard';
	static readonly RESOURCE = URI.from({ scheme: Schemas.walkThrough, authority: 'kode_yudao_project_wizard' });

	private static _instance: YudaoProjectWizardInput;

	// Keep the wizard singleton to avoid duplicate tabs for the same tool page.
	static get instance(): YudaoProjectWizardInput {
		if (!YudaoProjectWizardInput._instance || YudaoProjectWizardInput._instance.isDisposed()) {
			YudaoProjectWizardInput._instance = new YudaoProjectWizardInput();
		}
		return YudaoProjectWizardInput._instance;
	}

	override get typeId(): string {
		return YudaoProjectWizardInput.ID;
	}

	override get editorId(): string | undefined {
		return YudaoProjectWizardInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Singleton;
	}

	readonly resource = YudaoProjectWizardInput.RESOURCE;

	override getName(): string {
		return localize('kodeYudaoProjectWizardName', "Create Yudao Project");
	}

	override getIcon(): URI {
		return yudaoProjectWizardIcon;
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: this.resource,
			options: {
				override: YudaoProjectWizardInput.ID,
				pinned: true,
			}
		};
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof YudaoProjectWizardInput;
	}
}
