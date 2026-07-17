'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('licenseAdminAPI', {
  getConfig: () => invoke('license-admin:get-config'),
  generate: payload => invoke('license-admin:generate', payload),
  copy: text => invoke('license-admin:copy', text),
  save: payload => invoke('license-admin:save', payload),
  selectPrivateKey: () => invoke('license-admin:select-private-key'),
});
