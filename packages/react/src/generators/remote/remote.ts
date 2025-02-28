import { join } from 'path';
import {
  formatFiles,
  generateFiles,
  GeneratorCallback,
  joinPathFragments,
  names,
  readProjectConfiguration,
  runTasksInSerial,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';

import { normalizeOptions } from '../application/lib/normalize-options';
import applicationGenerator from '../application/application';
import { NormalizedSchema } from '../application/schema';
import { updateHostWithRemote } from './lib/update-host-with-remote';
import { updateModuleFederationProject } from '../../rules/update-module-federation-project';
import { Schema } from './schema';
import setupSsrGenerator from '../setup-ssr/setup-ssr';
import { setupSsrForRemote } from './lib/setup-ssr-for-remote';
import { setupTspathForRemote } from './lib/setup-tspath-for-remote';

export function addModuleFederationFiles(
  host: Tree,
  options: NormalizedSchema<Schema>
) {
  const templateVariables = {
    ...names(options.name),
    ...options,
    tmpl: '',
  };

  const pathToModuleFederationFiles = options.typescriptConfiguration
    ? 'module-federation-ts'
    : 'module-federation';

  generateFiles(
    host,
    join(__dirname, `./files/${pathToModuleFederationFiles}`),
    options.appProjectRoot,
    templateVariables
  );

  if (options.typescriptConfiguration) {
    const pathToWebpackConfig = joinPathFragments(
      options.appProjectRoot,
      'webpack.config.js'
    );
    const pathToWebpackProdConfig = joinPathFragments(
      options.appProjectRoot,
      'webpack.config.prod.js'
    );
    if (host.exists(pathToWebpackConfig)) {
      host.delete(pathToWebpackConfig);
    }
    if (host.exists(pathToWebpackProdConfig)) {
      host.delete(pathToWebpackProdConfig);
    }
  }
}

export async function remoteGenerator(host: Tree, schema: Schema) {
  return await remoteGeneratorInternal(host, {
    projectNameAndRootFormat: 'derived',
    ...schema,
  });
}

export async function remoteGeneratorInternal(host: Tree, schema: Schema) {
  const tasks: GeneratorCallback[] = [];
  const options: NormalizedSchema<Schema> = {
    ...(await normalizeOptions<Schema>(host, schema, '@nx/react:remote')),
    typescriptConfiguration: schema.typescriptConfiguration ?? false,
  };
  const initAppTask = await applicationGenerator(host, {
    ...options,
    // Only webpack works with module federation for now.
    bundler: 'webpack',
    skipFormat: true,
  });
  tasks.push(initAppTask);

  if (schema.host) {
    updateHostWithRemote(host, schema.host, options.projectName);
  }

  // Module federation requires bootstrap code to be dynamically imported.
  // Renaming original entry file so we can use `import(./bootstrap)` in
  // new entry file.
  host.rename(
    join(options.appProjectRoot, 'src/main.tsx'),
    join(options.appProjectRoot, 'src/bootstrap.tsx')
  );

  addModuleFederationFiles(host, options);
  updateModuleFederationProject(host, options);
  setupTspathForRemote(host, options);

  if (options.ssr) {
    const setupSsrTask = await setupSsrGenerator(host, {
      project: options.projectName,
      serverPort: options.devServerPort,
      skipFormat: true,
    });
    tasks.push(setupSsrTask);

    const setupSsrForRemoteTask = await setupSsrForRemote(
      host,
      options,
      options.projectName
    );
    tasks.push(setupSsrForRemoteTask);

    const projectConfig = readProjectConfiguration(host, options.projectName);
    projectConfig.targets.server.options.webpackConfig = joinPathFragments(
      projectConfig.root,
      `webpack.server.config.${options.typescriptConfiguration ? 'ts' : 'js'}`
    );
    updateProjectConfiguration(host, options.projectName, projectConfig);
  }

  if (!options.skipFormat) {
    await formatFiles(host);
  }

  return runTasksInSerial(...tasks);
}

export default remoteGenerator;
