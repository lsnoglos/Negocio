const SPREADSHEET_ID = '1TIKaqnmTsKKvNSHja2xxgv2Q87UB2Eh2l6DvTgMkUzE';
const ROOT_FOLDER_ID = '1LzHgraT5VU9uLWcp3RczHcYEPXs-2W0a';

const SHEETS = {
  CONFIG: 'configuracion',
  ACCESS: 'accesos',
  PRODUCTS: 'inventario',
  SALES: 'ventas',
  JOURNAL: 'libro_diario',
  LEDGER: 'libro_mayor'
};

const ROLE_PERMISSIONS = {
  admin: {
    viewDashboard: true,
    manageSettings: true,
    manageAccess: true,
    manageInventory: true,
    sellProducts: true,
    viewSales: true,
    viewJournal: true,
    viewLedger: true
  },
  vendedor: {
    viewDashboard: true,
    manageSettings: false,
    manageAccess: false,
    manageInventory: false,
    sellProducts: true,
    viewSales: true,
    viewJournal: false,
    viewLedger: false
  },
  cliente: {
    viewDashboard: false,
    manageSettings: false,
    manageAccess: false,
    manageInventory: false,
    sellProducts: false,
    viewSales: false,
    viewJournal: false,
    viewLedger: false
  },
  guest: {
    viewDashboard: false,
    manageSettings: false,
    manageAccess: false,
    manageInventory: false,
    sellProducts: false,
    viewSales: false,
    viewJournal: false,
    viewLedger: false
  }
};

function doGet() {
  ensureBootstrap();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Sistema Comercial')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getBootstrapData() {
  ensureBootstrap();
  const user = getCurrentUserData();
  const config = getBusinessConfig();
  const topProduct = getTopSellingProductBanner();
  return {
    appUrl: ScriptApp.getService().getUrl(),
    user,
    config,
    topProduct,
    permissions: ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.guest
  };
}

function getLoginUrl() {
  return `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(ScriptApp.getService().getUrl())}`;
}

function softLogout() {
  CacheService.getUserCache().put('isLoggedIn', 'false', 21600);
  return `${ScriptApp.getService().getUrl()}?logout=true`;
}

function getBusinessConfig() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
  const values = sheet.getDataRange().getValues();
  const map = {};
  values.forEach((row) => {
    if (row[0]) map[String(row[0]).trim()] = row[1] || '';
  });
  return {
    nombreNegocio: map.nombreNegocio || 'Mi Negocio',
    logoUrl: map.logoUrl || '',
    logoFileId: map.logoFileId || '',
    colorPrimario: map.colorPrimario || '#0b5fff',
    lowStockThreshold: Number(map.lowStockThreshold || 5)
  };
}

function saveBusinessConfig(payload) {
  enforcePermission('manageSettings');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.CONFIG);
  const pairs = [
    ['nombreNegocio', payload.nombreNegocio || 'Mi Negocio'],
    ['colorPrimario', payload.colorPrimario || '#0b5fff'],
    ['lowStockThreshold', Number(payload.lowStockThreshold || 5)]
  ];

  if (payload.logoBase64 && payload.logoMimeType) {
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const folder = getOrCreateFolder(root, 'branding');
    const blob = Utilities.newBlob(
      Utilities.base64Decode(payload.logoBase64),
      payload.logoMimeType,
      `logo_${new Date().getTime()}.png`
    );
    const file = folder.createFile(blob).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    pairs.push(['logoUrl', `https://drive.google.com/uc?export=view&id=${file.getId()}`]);
    pairs.push(['logoFileId', file.getId()]);
  }

  upsertConfig(sheet, pairs);
  return { success: true, config: getBusinessConfig() };
}

function getCurrentUserData() {
  const email = Session.getActiveUser().getEmail();
  if (!email) return { email: '', role: 'guest', displayName: 'Invitado' };

  const access = getAccessByEmail(email);
  if (!access) {
    return { email, role: 'cliente', displayName: email.split('@')[0] };
  }

  return {
    email,
    role: access.role,
    displayName: access.nombre || email.split('@')[0]
  };
}

function listAccessUsers() {
  enforcePermission('manageAccess');
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ACCESS);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data
    .filter((r) => r[0])
    .map((r) => ({
      email: r[0],
      role: (r[1] || 'cliente').toLowerCase(),
      nombre: r[2] || '',
      activo: String(r[3] || 'SI').toUpperCase() !== 'NO'
    }));
}

function upsertAccessUser(payload) {
  enforcePermission('manageAccess');
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) throw new Error('Email es requerido');
  const role = String(payload.role || 'cliente').toLowerCase();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.ACCESS);
  const data = sheet.getDataRange().getValues();
  let rowIndex = data.findIndex((row, idx) => idx > 0 && String(row[0]).toLowerCase() === email);
  const rowData = [email, role, payload.nombre || '', payload.activo === false ? 'NO' : 'SI'];
  if (rowIndex === -1) {
    sheet.appendRow(rowData);
  } else {
    rowIndex += 1;
    sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
  }
  return { success: true };
}

function listProducts() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.PRODUCTS);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.filter((r) => r[0]).map((r) => rowToObject(headers, r));
}

function upsertProduct(payload) {
  enforcePermission('manageInventory');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.PRODUCTS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  let product = {
    productId: payload.productId || `PROD_${new Date().getTime()}`,
    nombre: payload.nombre,
    descripcion: payload.descripcion || '',
    precio: Number(payload.precio || 0),
    cantidad: Number(payload.cantidad || 0),
    categoria: payload.categoria || '',
    imageUrl: payload.imageUrl || '',
    imageFileId: payload.imageFileId || '',
    qrUrl: payload.qrUrl || '',
    qrFileId: payload.qrFileId || '',
    activo: payload.activo === false ? 'NO' : 'SI',
    updatedAt: new Date(),
    updatedBy: getCurrentUserData().email || ''
  };

  if (payload.imageBase64 && payload.imageMimeType) {
    const folder = getProductFolder(product.nombre);
    const blob = Utilities.newBlob(Utilities.base64Decode(payload.imageBase64), payload.imageMimeType, 'producto.jpg');
    const file = folder.createFile(blob).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    product.imageFileId = file.getId();
    product.imageUrl = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
  }

  if (!product.qrUrl) {
    const qrBlob = UrlFetchApp.fetch(`https://chart.googleapis.com/chart?cht=qr&chs=600x600&chl=${encodeURIComponent(product.productId)}`).getBlob().setName('qr.png');
    const folder = getProductFolder(product.nombre);
    const qrFile = folder.createFile(qrBlob).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    product.qrFileId = qrFile.getId();
    product.qrUrl = `https://drive.google.com/uc?export=view&id=${qrFile.getId()}`;
  }

  const row = headers.map((h) => product[h] || '');
  const existing = values.findIndex((r, idx) => idx > 0 && r[0] === product.productId);
  if (existing === -1) {
    sheet.appendRow(row);
  } else {
    const rowNumber = existing + 1;
    sheet.getRange(rowNumber + 1, 1, 1, row.length).setValues([row]);
  }

  return { success: true, product };
}

function registerSale(payload) {
  enforcePermission('sellProducts');
  const user = getCurrentUserData();
  const items = payload.items || [];
  if (!items.length) throw new Error('No hay productos en la venta');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const salesSheet = ss.getSheetByName(SHEETS.SALES);
  const productsSheet = ss.getSheetByName(SHEETS.PRODUCTS);
  const journalSheet = ss.getSheetByName(SHEETS.JOURNAL);

  const saleId = `SALE_${new Date().getTime()}`;
  const paidWith = Number(payload.paidWith || 0);
  const total = items.reduce((sum, i) => sum + Number(i.precio) * Number(i.cantidad), 0);
  const change = paidWith - total;

  items.forEach((item) => {
    salesSheet.appendRow([
      saleId,
      new Date(),
      item.productId,
      item.nombre,
      Number(item.cantidad),
      Number(item.precio),
      Number(item.cantidad) * Number(item.precio),
      user.email,
      payload.customerName || 'Consumidor final'
    ]);

    decrementProductStock(productsSheet, item.productId, Number(item.cantidad));
  });

  journalSheet.appendRow([
    `JRN_${new Date().getTime()}`,
    new Date(),
    `Venta ${saleId}`,
    total,
    0,
    saleId,
    user.email
  ]);

  updateLedgerFromJournal();

  sendSaleEmail(user.email, {
    saleId,
    items,
    total,
    paidWith,
    change,
    customerName: payload.customerName || 'Consumidor final'
  });

  return { success: true, saleId, total, paidWith, change };
}

function getDashboardStats() {
  enforcePermission('viewDashboard');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sales = ss.getSheetByName(SHEETS.SALES).getDataRange().getValues();
  const headers = sales.shift();
  const idx = indexByHeaders(headers);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(dayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  let todayTotal = 0;
  const dayMap = {};
  const weekMap = {};

  sales.forEach((r) => {
    const date = new Date(r[idx.fecha]);
    const subtotal = Number(r[idx.subtotal] || 0);
    const productName = r[idx.nombre] || 'Producto';
    if (date >= dayStart) {
      todayTotal += subtotal;
      dayMap[productName] = (dayMap[productName] || 0) + Number(r[idx.cantidad] || 0);
    }
    if (date >= weekStart) {
      weekMap[productName] = (weekMap[productName] || 0) + Number(r[idx.cantidad] || 0);
    }
  });

  return {
    todayTotal,
    topToday: topFromMap(dayMap),
    topWeek: topFromMap(weekMap)
  };
}

function listJournal() {
  enforcePermission('viewJournal');
  const data = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.JOURNAL).getDataRange().getValues();
  const headers = data.shift();
  return data.filter((r) => r[0]).map((r) => rowToObject(headers, r));
}

function listLedger() {
  enforcePermission('viewLedger');
  const data = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LEDGER).getDataRange().getValues();
  const headers = data.shift();
  return data.filter((r) => r[0]).map((r) => rowToObject(headers, r));
}

function getTopSellingProductBanner() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sales = ss.getSheetByName(SHEETS.SALES).getDataRange().getValues();
  const products = listProducts();
  if (sales.length < 2) return null;
  const headers = sales.shift();
  const idx = indexByHeaders(headers);
  const map = {};
  sales.forEach((r) => {
    const pid = String(r[idx.productId] || '');
    if (!pid) return;
    map[pid] = (map[pid] || 0) + Number(r[idx.cantidad] || 0);
  });
  const top = Object.keys(map).sort((a, b) => map[b] - map[a])[0];
  if (!top) return null;
  const product = products.find((p) => p.productId === top);
  if (!product) return null;
  return {
    nombre: product.nombre,
    precio: Number(product.precio || 0),
    imageUrl: product.imageUrl || '',
    cantidadVendida: map[top]
  };
}

function ensureBootstrap() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheet(ss, SHEETS.CONFIG, ['key', 'value']);
  ensureSheet(ss, SHEETS.ACCESS, ['email', 'role', 'nombre', 'activo']);
  ensureSheet(ss, SHEETS.PRODUCTS, ['productId', 'nombre', 'descripcion', 'precio', 'cantidad', 'categoria', 'imageUrl', 'imageFileId', 'qrUrl', 'qrFileId', 'activo', 'updatedAt', 'updatedBy']);
  ensureSheet(ss, SHEETS.SALES, ['saleId', 'fecha', 'productId', 'nombre', 'cantidad', 'precio', 'subtotal', 'vendedorEmail', 'clienteNombre']);
  ensureSheet(ss, SHEETS.JOURNAL, ['journalId', 'fecha', 'descripcion', 'debito', 'credito', 'refId', 'usuario']);
  ensureSheet(ss, SHEETS.LEDGER, ['ledgerId', 'fecha', 'cuenta', 'debito', 'credito', 'balance', 'refId']);

  const config = ss.getSheetByName(SHEETS.CONFIG);
  if (config.getLastRow() < 2) {
    config.appendRow(['nombreNegocio', 'Mi Negocio']);
    config.appendRow(['colorPrimario', '#0b5fff']);
    config.appendRow(['lowStockThreshold', 5]);
  }
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
}

function upsertConfig(sheet, keyValues) {
  const values = sheet.getDataRange().getValues();
  const map = {};
  values.forEach((row, idx) => {
    if (idx > 0) map[String(row[0]).trim()] = idx + 1;
  });

  keyValues.forEach((pair) => {
    if (map[pair[0]]) {
      sheet.getRange(map[pair[0]], 2).setValue(pair[1]);
    } else {
      sheet.appendRow(pair);
    }
  });
}

function getAccessByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const rows = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ACCESS).getDataRange().getValues();
  rows.shift();
  const hit = rows.find((r) => String(r[0] || '').trim().toLowerCase() === normalized && String(r[3] || 'SI').toUpperCase() !== 'NO');
  if (!hit) return null;
  return { email: hit[0], role: String(hit[1] || 'cliente').toLowerCase(), nombre: hit[2] || '' };
}

function enforcePermission(permission) {
  const user = getCurrentUserData();
  const allowed = (ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.guest)[permission];
  if (!allowed) throw new Error('No tienes permisos para esta operación');
}

function rowToObject(headers, row) {
  return headers.reduce((acc, h, i) => {
    acc[h] = row[i];
    return acc;
  }, {});
}

function indexByHeaders(headers) {
  return headers.reduce((acc, h, i) => {
    acc[h] = i;
    return acc;
  }, {});
}

function topFromMap(map) {
  const keys = Object.keys(map);
  if (!keys.length) return null;
  const key = keys.sort((a, b) => map[b] - map[a])[0];
  return { nombre: key, cantidad: map[key] };
}

function decrementProductStock(sheet, productId, qty) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = indexByHeaders(headers);
  const rowIndex = data.findIndex((r, i) => i > 0 && r[idx.productId] === productId);
  if (rowIndex === -1) return;
  const current = Number(data[rowIndex][idx.cantidad] || 0);
  sheet.getRange(rowIndex + 1, idx.cantidad + 1).setValue(Math.max(0, current - qty));
}

function updateLedgerFromJournal() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const journal = ss.getSheetByName(SHEETS.JOURNAL).getDataRange().getValues();
  const ledger = ss.getSheetByName(SHEETS.LEDGER);

  const oldRows = ledger.getLastRow();
  if (oldRows > 1) ledger.getRange(2, 1, oldRows - 1, ledger.getLastColumn()).clearContent();

  const headers = journal.shift();
  const idx = indexByHeaders(headers);
  let balance = 0;
  journal.forEach((row) => {
    if (!row[0]) return;
    const deb = Number(row[idx.debito] || 0);
    const cre = Number(row[idx.credito] || 0);
    balance += deb - cre;
    ledger.appendRow([
      `LDG_${new Date(row[idx.fecha]).getTime()}`,
      row[idx.fecha],
      row[idx.descripcion],
      deb,
      cre,
      balance,
      row[idx.refId]
    ]);
  });
}

function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(folderName);
}

function getProductFolder(productName) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const productsRoot = getOrCreateFolder(root, 'productos');
  return getOrCreateFolder(productsRoot, sanitizeFolderName(productName || 'producto_sin_nombre'));
}

function sanitizeFolderName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 80);
}

function sendSaleEmail(to, sale) {
  if (!to) return;
  const lines = sale.items
    .map((i) => `<li>${i.nombre} x ${i.cantidad} = ${Number(i.cantidad) * Number(i.precio)}</li>`)
    .join('');
  MailApp.sendEmail({
    to,
    subject: `Ticket de venta ${sale.saleId}`,
    htmlBody: `
      <h3>Detalle de venta</h3>
      <p><b>ID:</b> ${sale.saleId}</p>
      <p><b>Cliente:</b> ${sale.customerName}</p>
      <ul>${lines}</ul>
      <p><b>Total:</b> ${sale.total}</p>
      <p><b>Pagó con:</b> ${sale.paidWith}</p>
      <p><b>Cambio:</b> ${sale.change}</p>
    `
  });
}
