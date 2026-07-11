/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type YudaoSourceProvider = 'auto' | 'gitee' | 'github';
export type YudaoBackendKind = 'none' | 'boot' | 'cloud';
export type YudaoFrontendKind = 'none' | 'adminVue3' | 'adminVben' | 'mallUniapp' | 'adminVue2' | 'adminUniapp' | 'goView';

// Built-in fallbacks for the first render; runtime still refreshes real branches with git ls-remote.
export interface IYudaoRepoMirrors {
	readonly gitee: string;
	readonly github: string;
}

export interface IYudaoBranchMirrors {
	readonly gitee: readonly string[];
	readonly github: readonly string[];
}

export interface IYudaoProjectPreset {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly workspaceFolder: string;
	readonly mirrors: IYudaoRepoMirrors;
	readonly branches: IYudaoBranchMirrors;
}

export const yudaoBackendPresets: Record<Exclude<YudaoBackendKind, 'none'>, IYudaoProjectPreset> = {
	boot: {
		id: 'boot',
		label: 'RuoYi Vue Pro / Boot monolith',
		description: 'ruoyi-vue-pro backend for single-service deployments.',
		workspaceFolder: 'yudao-backend',
		mirrors: {
			gitee: 'https://gitee.com/zhijiantianya/ruoyi-vue-pro.git',
			github: 'https://github.com/YunaiV/ruoyi-vue-pro.git',
		},
		branches: {
			gitee: ['master-jdk17', 'master', 'master-jdk25', 'develop', 'master-dm8-jdk17', 'master-jdk17-bpm-bug-fix', 'feat/iot-2026', 'feature/im-dev'],
			github: ['master-jdk17', 'master', 'master-jdk25', 'develop', 'feature/bpm', 'feature/iot', 'feature/jdk25'],
		},
	},
	cloud: {
		id: 'cloud',
		label: 'Yudao Cloud / Microservices',
		description: 'yudao-cloud backend for Nacos-based microservice deployments.',
		workspaceFolder: 'yudao-backend',
		mirrors: {
			gitee: 'https://gitee.com/zhijiantianya/yudao-cloud.git',
			github: 'https://github.com/YunaiV/yudao-cloud.git',
		},
		branches: {
			gitee: ['master-jdk17', 'master', 'master-jdk25', 'develop'],
			github: ['master-jdk17', 'master', 'master-jdk25', 'develop'],
		},
	},
};

export const yudaoFrontendPresets: Record<Exclude<YudaoFrontendKind, 'none'>, IYudaoProjectPreset> = {
	adminVue3: {
		id: 'adminVue3',
		label: 'yudao-ui-admin-vue3',
		description: 'Vue3 + element-plus admin frontend.',
		mirrors: {
			gitee: 'https://gitee.com/yudaocode/yudao-ui-admin-vue3.git',
			github: 'https://github.com/yudaocode/yudao-ui-admin-vue3.git',
		},
		workspaceFolder: 'yudao-ui-admin-vue3',
		branches: {
			gitee: ['master', 'dev', 'im', 'feature/iot', 'master-bpm-bug-fix'],
			github: ['master', 'dev', 'feature/bpm', 'feat/mes'],
		},
	},
	adminVben: {
		id: 'adminVben',
		label: 'yudao-ui-admin-vben',
		description: 'Vue3 + vben + ant-design-vue admin frontend.',
		mirrors: {
			gitee: 'https://gitee.com/yudaocode/yudao-ui-admin-vben.git',
			github: 'https://github.com/yudaocode/yudao-ui-admin-vben.git',
		},
		workspaceFolder: 'yudao-ui-admin-vben',
		branches: {
			gitee: ['master', 'master-vben2.0'],
			github: ['master', 'dev', 'master-vben2.0'],
		},
	},
	mallUniapp: {
		id: 'mallUniapp',
		label: 'yudao-mall-uniapp',
		description: 'uni-app mall mini program frontend.',
		mirrors: {
			gitee: 'https://gitee.com/yudaocode/yudao-mall-uniapp.git',
			github: 'https://github.com/yudaocode/yudao-mall-uniapp.git',
		},
		workspaceFolder: 'yudao-mall-uniapp',
		branches: {
			gitee: ['master', 'develop', 'master-cli', 'master-vue2'],
			github: ['master', 'master-cli', 'master-vue2'],
		},
	},
	adminVue2: {
		id: 'adminVue2',
		label: 'yudao-ui-admin-vue2',
		description: 'Vue2 + element-ui admin frontend.',
		mirrors: {
			gitee: 'https://gitee.com/yudaocode/yudao-ui-admin-vue2.git',
			github: 'https://github.com/yudaocode/yudao-ui-admin-vue2.git',
		},
		workspaceFolder: 'yudao-ui-admin-vue2',
		branches: {
			gitee: ['master', 'dev'],
			github: ['master'],
		},
	},
	adminUniapp: {
		id: 'adminUniapp',
		label: 'yudao-ui-admin-uniapp',
		description: 'Vue2 + element-ui admin frontend.',
		mirrors: {
			gitee: 'https://gitee.com/yudaocode/yudao-ui-admin-uniapp.git',
			github: 'https://github.com/yudaocode/yudao-ui-admin-uniapp.git',
		},
		workspaceFolder: 'yudao-ui-admin-uniapp',
		branches: {
			gitee: ['master', 'master-vue2', 'feature/ai'],
			github: ['master', 'master-vue2'],
		},
	},
	goView: {
		id: 'goView',
		label: 'yudao-ui-go-view',
		description: 'Vue3 + naive-ui dashboard and report frontend.',
		mirrors: {
			gitee: 'https://gitee.com/yudaocode/yudao-ui-go-view.git',
			github: 'https://github.com/yudaocode/yudao-ui-go-view.git',
		},
		workspaceFolder: 'yudao-ui-go-view',
		branches: {
			gitee: ['master'],
			github: ['master'],
		},
	},
};

export const yudaoFrontendPresetOrder: readonly Exclude<YudaoFrontendKind, 'none'>[] = [
	'adminVue3',
	'adminVben',
	'mallUniapp',
	'adminVue2',
	'adminUniapp',
	'goView',
];

export interface IYudaoModulePreset {
	readonly id: string;
	readonly label: string;
	readonly required?: boolean;
}

// Module choices currently feed .kode/yudao-project.json metadata; they do not prune backend sources yet.
export const yudaoModulePresets: readonly IYudaoModulePreset[] = [
	{ id: 'yudao-module-system', label: 'System (yudao-module-system)', required: true },
	{ id: 'yudao-module-infra', label: 'Infra (yudao-module-infra)', required: true },
	{ id: 'yudao-module-bpm', label: 'BPM (yudao-module-bpm)' },
	{ id: 'yudao-module-pay', label: 'Pay (yudao-module-pay)' },
	{ id: 'yudao-module-mp', label: 'MP (yudao-module-mp)' },
	{ id: 'yudao-module-mall', label: 'Mall (yudao-module-mall)' },
	{ id: 'yudao-module-member', label: 'Member (yudao-module-member)' },
	{ id: 'yudao-module-crm', label: 'CRM (yudao-module-crm)' },
	{ id: 'yudao-module-erp', label: 'ERP (yudao-module-erp)' },
	{ id: 'yudao-module-ai', label: 'AI (yudao-module-ai)' },
	{ id: 'yudao-module-report', label: 'Report (yudao-module-report)' },
	{ id: 'yudao-module-iot', label: 'IoT (yudao-module-iot)' },
	{ id: 'yudao-module-im', label: 'IM (yudao-module-im)' },
	{ id: 'yudao-module-mes', label: 'MES (yudao-module-mes)' },
	{ id: 'yudao-module-wms', label: 'WMS (yudao-module-wms)' },
] as const;

export const yudaoRequiredModuleIds = yudaoModulePresets
	.filter(module => module.required)
	.map(module => module.id);
