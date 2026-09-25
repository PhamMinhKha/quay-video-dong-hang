#!/usr/bin/env node
// Script to fix preload.js after build
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const preloadPath = path.join(__dirname, 'dist/main/preload.js');

const content = `"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('electronAPI', {
    getVideosDir: () => ipcRenderer.invoke('get-videos-dir'),
    saveVideo: (data) => ipcRenderer.invoke('save-video', data),
    listVideos: () => ipcRenderer.invoke('list-videos'),
    deleteVideo: (filename) => ipcRenderer.invoke('delete-video', filename),
    getVideoPath: (filename) => ipcRenderer.invoke('get-video-path', filename),
    searchByQR: (qrText) => ipcRenderer.invoke('search-by-qr', qrText),
    showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
    getStoragePath: () => ipcRenderer.invoke('get-storage-path'),
    setStoragePath: (path) => ipcRenderer.invoke('set-storage-path', path),
    selectStorageFolder: () => ipcRenderer.invoke('select-storage-folder'),
    getDatabasePath: () => ipcRenderer.invoke('get-database-path'),
    setDatabasePath: (path) => ipcRenderer.invoke('set-database-path', path),
    exportQRSegments: (data) => ipcRenderer.invoke('export-qr-segments', data),
    exportVideoSegment: (data) => ipcRenderer.invoke('export-video-segment', data),
    adbGetDevices: () => ipcRenderer.invoke('adb-get-devices'),
    adbForwardDevice: (deviceId) => ipcRenderer.invoke('adb-forward-device', deviceId),
    phoneStartRtsp: (rtspUrl) => ipcRenderer.invoke('phone-start-rtsp', rtspUrl),
    phoneStopRtsp: () => ipcRenderer.invoke('phone-stop-rtsp'),
    phoneStartRecord: (filename) => ipcRenderer.invoke('phone-start-record', filename),
    phoneStopRecord: (metadata) => ipcRenderer.invoke('phone-stop-record', metadata),
    onPhoneFrame: (callback) => {
        const handler = (_event, base64) => callback(base64);
        ipcRenderer.on('phone-frame', handler);
        return () => ipcRenderer.removeListener('phone-frame', handler);
    },
    onPhoneQr: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on('phone-qr', handler);
        return () => ipcRenderer.removeListener('phone-qr', handler);
    },
    onPhoneRecordDied: (callback) => {
        const handler = (_event, info) => callback(info);
        ipcRenderer.on('phone-record-died', handler);
        return () => ipcRenderer.removeListener('phone-record-died', handler);
    },
});
`;

fs.writeFileSync(preloadPath, content);

// Also create package.json in dist/main to override type
const packageJsonPath = path.join(__dirname, 'dist/main/package.json');
const packageJsonContent = JSON.stringify({ type: 'commonjs' }, null, 2);
fs.writeFileSync(packageJsonPath, packageJsonContent);

console.log('✅ Fixed preload.js and package.json');

