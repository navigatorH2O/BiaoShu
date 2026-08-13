const { ipcMain } = require('electron');

function registerDeliveryDocsIpc({ deliveryDocsService }) {
  const subscribe = (event) => deliveryDocsService.subscribe(event.sender);

  ipcMain.on('delivery-docs:subscribe', (event) => {
    subscribe(event);
  });

  ipcMain.handle('delivery-docs:load-state', (event) => {
    subscribe(event);
    return deliveryDocsService.getState();
  });

  ipcMain.handle('delivery-docs:import-projects', (event) => {
    subscribe(event);
    return deliveryDocsService.importProjects(event.sender);
  });

  ipcMain.handle('delivery-docs:set-active', (event, projectId, docType) => {
    subscribe(event);
    return deliveryDocsService.setActive(projectId, docType);
  });

  ipcMain.handle('delivery-docs:generate-context', (event, projectId) => {
    subscribe(event);
    return deliveryDocsService.generateProjectContext(projectId, event.sender);
  });

  ipcMain.handle('delivery-docs:save-context', (event, projectId, context) => {
    subscribe(event);
    return deliveryDocsService.saveContext(projectId, context);
  });

  ipcMain.handle('delivery-docs:confirm-context', (event, projectId) => {
    subscribe(event);
    return deliveryDocsService.confirmContext(projectId);
  });

  ipcMain.handle('delivery-docs:generate-outline', (event, projectId, docType) => {
    subscribe(event);
    return deliveryDocsService.generateOutline(projectId, docType, event.sender);
  });

  ipcMain.handle('delivery-docs:save-outline', (event, projectId, docType, outline) => {
    subscribe(event);
    return deliveryDocsService.saveOutline(projectId, docType, outline);
  });

  ipcMain.handle('delivery-docs:generate-document', (event, projectId, docType, options) => {
    subscribe(event);
    return deliveryDocsService.generateDocument(projectId, docType, event.sender, options);
  });

  ipcMain.handle('delivery-docs:skip-document', (event, projectId, docType) => {
    subscribe(event);
    return deliveryDocsService.skipDocument(projectId, docType);
  });

  ipcMain.handle('delivery-docs:read-content', (event, projectId, docType) => {
    subscribe(event);
    return deliveryDocsService.readContent(projectId, docType);
  });

  ipcMain.handle('delivery-docs:select-output-dir', (event, projectId) => {
    subscribe(event);
    return deliveryDocsService.selectOutputDir(projectId, event.sender);
  });

  ipcMain.handle('delivery-docs:export-document', (event, projectId, docType, options) => {
    subscribe(event);
    return deliveryDocsService.exportDocument(projectId, docType, event.sender, options);
  });

  ipcMain.handle('delivery-docs:open-output-folder', (event, projectId) => {
    subscribe(event);
    return deliveryDocsService.openOutputFolder(projectId);
  });

  ipcMain.handle('delivery-docs:clear', (event) => {
    subscribe(event);
    return deliveryDocsService.clear();
  });
}

module.exports = {
  registerDeliveryDocsIpc,
};
