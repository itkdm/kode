/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const sourcePath = path.join(repoRoot, 'product.kode.json');
const targetPath = path.join(repoRoot, 'product.overrides.json');

const source = fs.readFileSync(sourcePath, 'utf8');
let shouldWrite = true;

try {
	shouldWrite = fs.readFileSync(targetPath, 'utf8') !== source;
} catch {
	// Missing overrides are expected on a fresh checkout.
}

if (shouldWrite) {
	fs.writeFileSync(targetPath, source);
	console.log('Applied Kode product overrides.');
}
