// @ts-nocheck
import { window, commands, workspace, ProgressLocation } from 'vscode';

import MaximoConfig from './maximo/maximo-config';
import MaximoClient from './maximo/maximo-client';
import { validateSettings } from './settings';
import * as path from 'path'

var password;
var lastUser;
var lastHost;
var lastPort;

export function activate(context) {

	let disposable = commands.registerCommand(
		"maximo-script-deploy.deploy",
		async function () {

			// make sure we have all the settings.
			if (!validateSettings()) {
				return;
			}

			const settings = workspace.getConfiguration('sharptree');

			const host = settings.get('maximo.host');
			const userName = settings.get('maximo.user');
			const useSSL = settings.get('maximo.useSSL');
			const port = settings.get('maximo.port');
			const authType = settings.get('maximo.authenticationType')
			const allowUntrustedCerts = settings.get('maximo.allowUntrustedCerts');

			// if the last user doesn't match the current user then request the password.
			if (lastUser && lastUser !== userName) {
				password = null;
			}

			if (lastHost && lastHost !== host) {
				password = null;
			}

			if (lastPort && lastPort !== port) {
				password = null;
			}

			if (!password) {
				password = await window.showInputBox({
					prompt: `Enter ${userName}'s password`,
					password: true,
					validateInput: text => {
						if (!text || text.trim() === '') {
							return 'A password is required';
						}
					}
				});
			}

			// if the password has not been set then just return.
			if (!password || password.trim() === '') {
				return;
			}

			const config = new MaximoConfig({
				username: userName,
				password: password,
				useSSL: useSSL,
				host: host,
				port: port,
				authType: authType,
				allowUntrustedCerts: allowUntrustedCerts
			});

			let client;

			try {
				client = new MaximoClient(config);
				var loginSuccessful = await client.connect().then((success) => {
					lastUser = userName;
					lastHost = host;
					lastPort = port;

					return true;
				}, (error) => {
					// clear the password on error
					password = null;
					lastUser = null;
					// show the error message to the user.
					window.showInformationMessage(error.message, { modal: true });
					return false;
				});
				if (loginSuccessful) {

					var version = await client.maximoVersion();
					const supportedVersions = ['7608', '7609', '76010', '76011', '7610', '7611', '7612'];

					if (!version) {
						window.showErrorMessage(`Could not determine the Maximo version. Only Maximo 7.6.0.8 and greater are supported`, { modal: true });
						return;
					} else {
						var checkVersion = version.substr(1, version.indexOf('-') - 1);
						if (!supportedVersions.includes(checkVersion)) {
							window.showErrorMessage(`The Maximo version ${version} is not supported.`, { modal: true });
							return;
						}
					}

					var javaVersion = await client.javaVersion();

					if (!javaVersion || javaVersion !== '1.8') {
						window.showErrorMessage(`Maximo Java version ${javaVersion} is not supported. Only Java version 1.8 is supported.`, { modal: true });
						return;
					}

					if (!await client.installed()) {
						await window.showInformationMessage('Configurations are required to deploy automation scripts.  Do you want to configure Maximo now?', { modal: true }, ...['Yes']).then(async (response) => {
							if (response === 'Yes') {
								await window.withProgress({
									title: 'Configuring Maximo...',
									location: ProgressLocation.Notification
								}, async (progress) => {
									var result = await client.install(progress);
									if (result && result.status === 'error') {
										window.showErrorMessage(result.message, { modal: true });
									} else {
										window.showInformationMessage('Maximo configuration successful.', { modal: true });
									}
								}
								);
							}
						});
						return;
					} else {
						// Get the active text editor
						const editor = window.activeTextEditor;
						if (editor) {
							let document = editor.document;

							if (document) {
								let fileName = path.basename(document.fileName);
								if (fileName.endsWith('.js')) {
									// Get the document text
									const script = document.getText();
									if (script && script.trim().length > 0) {
										await new Promise(resolve => setTimeout(resolve, 500));
										var result = await window.withProgress({ cancellable: false, title: `Script`, location: ProgressLocation.Notification },
											async (progress) => {
												progress.report({ message: `Deploying script ${fileName}`, increment: 0 });

												await new Promise(resolve => setTimeout(resolve, 500));
												let result = await client.postScript(script, progress, fileName);

												if (result) {
													if (result.status === 'error') {
														window.showErrorMessage(result.message, { modal: true });
													} else {
														progress.report({ increment: 100, message: `Successfully deployed ${fileName}` });
														await new Promise(resolve => setTimeout(resolve, 2000));
													}
												} else {
													window.showErrorMessage('Did not receive a response from Maximo.', { modal: true });
												}
												return result;
											});
									} else {
										window.showErrorMessage('The selected Automation Script cannot be empty.', { modal: true });
									}
								} else {
									window.showErrorMessage('The selected Automation Script must have a Javascript (\'.js\') file extension.', { modal: true });
								}
							} else {
								window.showErrorMessage('An Automation Script must be selected to deploy.', { modal: true });
							}
						} else {
							window.showErrorMessage('An Automation Script must be selected to deploy.', { modal: true });
						}
					}
				}
			} catch (error) {
				if (error && typeof error.message !== 'undefined') {
					window.showErrorMessage(error.message, { modal: true });
				} else {
					window.showErrorMessage('An unexpected error occured: ' + error, { modal: true });
				}

			} finally {
				// if the client exists then disconnect it.
				if (client) {
					await client.disconnect().catch((error) => {
						//do nothing with this
					});
				}
			}
		}
	);

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
function deactivate() { }

export default {
	activate,
	deactivate,
};
