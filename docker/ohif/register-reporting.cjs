// Build-time source registration, never a generated-bundle patch.
const fs = require('fs');
const pluginPath = 'platform/app/pluginConfig.json';
const plugins = JSON.parse(fs.readFileSync(pluginPath));
plugins.extensions.push({ packageName: '@rispro/extension-reporting' });
fs.writeFileSync(pluginPath, JSON.stringify(plugins, null, 2));
const modePath = 'modes/longitudinal/src/index.ts';
const source = fs.readFileSync(modePath, 'utf8');
if (!source.includes('...basicDependencies,')) throw Error('Pinned OHIF mode integration changed');
fs.writeFileSync(modePath, source.replace('...basicDependencies,', "...basicDependencies,\n  '@rispro/extension-reporting': '1.0.0',"));
const appPath = 'platform/app/package.json';
const app = JSON.parse(fs.readFileSync(appPath));
app.dependencies['@rispro/extension-reporting'] = '1.0.0';
fs.writeFileSync(appPath, JSON.stringify(app, null, 2));
