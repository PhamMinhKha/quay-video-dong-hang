import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

export interface AdbDevice {
  id: string;
  model: string;
  status: string;
}

function bundledAdbCandidates(): string[] {
  const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const list: string[] = [];

  try {
    if (app?.isPackaged) {
      // electron-builder extraResources → resources/adb/adb.exe
      list.push(path.join(process.resourcesPath, 'adb', adbName));
      list.push(path.join(process.resourcesPath, 'platform-tools', adbName));
    }
  } catch {
    /* app may not be ready yet */
  }

  // Dev: project/resources/adb (copy từ AWC)
  list.push(path.join(process.cwd(), 'resources', 'adb', adbName));
  list.push(path.join(process.cwd(), 'resources', 'platform-tools', adbName));
  list.push(path.join(__dirname, '..', '..', 'resources', 'adb', adbName));
  list.push(path.join(__dirname, '..', '..', 'resources', 'platform-tools', adbName));

  return list;
}

function candidateAdbPaths(): string[] {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  return [
    ...bundledAdbCandidates(),
    // AWC đã cài sẵn trên máy
    path.join(programFiles, 'AWC', 'adb', 'adb.exe'),
    path.join(programFilesX86, 'AWC', 'adb', 'adb.exe'),
    path.join(localAppData, 'AWC', 'adb', 'adb.exe'),
    path.join(localAppData, 'Programs', 'AWC', 'adb', 'adb.exe'),
    'adb',
    path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(home, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    '/usr/local/bin/adb',
    '/usr/bin/adb',
  ];
}

let cachedAdb: string | null = null;

export async function resolveAdbPath(): Promise<string> {
  if (cachedAdb) {
    if (cachedAdb === 'adb' || fs.existsSync(cachedAdb)) return cachedAdb;
    cachedAdb = null;
  }

  for (const candidate of candidateAdbPaths()) {
    try {
      if (candidate !== 'adb' && !fs.existsSync(candidate)) continue;
      await execFileAsync(candidate, ['version'], {
        timeout: 5000,
        windowsHide: true,
        cwd: path.dirname(candidate === 'adb' ? process.cwd() : candidate),
      });
      cachedAdb = candidate;
      console.log('✅ Using ADB at:', candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }

  throw new Error(
    'Không tìm thấy ADB. App sẽ dùng ADB kèm theo (resources/adb) hoặc từ C:\\Program Files\\AWC\\adb. Bạn cũng có thể dùng chế độ WiFi.'
  );
}

function adbCwd(adbPath: string): string | undefined {
  if (adbPath === 'adb') return undefined;
  return path.dirname(adbPath);
}

export async function adbGetDevices(): Promise<AdbDevice[]> {
  const adb = await resolveAdbPath();
  const cwd = adbCwd(adb);

  try {
    await execFileAsync(adb, ['start-server'], { timeout: 10000, windowsHide: true, cwd });
  } catch {
    /* ignore */
  }

  const { stdout } = await execFileAsync(adb, ['devices'], { timeout: 8000, windowsHide: true, cwd });
  const lines = stdout.split(/\r?\n/).slice(1).map(l => l.trim()).filter(Boolean);
  const devices: AdbDevice[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const id = parts[0];
    const status = parts[1] || '';
    if (!id) continue;
    if (status === 'offline') continue;

    if (status === 'unauthorized') {
      devices.push({
        id,
        model: 'Chưa Allow USB debugging — nhấn Allow trên điện thoại',
        status,
      });
      continue;
    }

    let model = id;
    try {
      const modelOut = await execFileAsync(
        adb,
        ['-s', id, 'shell', 'getprop', 'ro.product.model'],
        { timeout: 5000, windowsHide: true, cwd }
      );
      model = modelOut.stdout.trim() || id;
    } catch {
      /* keep id */
    }

    devices.push({ id, model, status: status || 'device' });
  }

  return devices;
}

export async function adbForwardDevice(deviceId: string): Promise<{ success: boolean; message: string }> {
  const adb = await resolveAdbPath();
  const cwd = adbCwd(adb);

  for (const port of ['tcp:8080', 'tcp:8554']) {
    try {
      await execFileAsync(adb, ['-s', deviceId, 'forward', '--remove', port], {
        timeout: 5000,
        windowsHide: true,
        cwd,
      });
    } catch {
      /* ignore */
    }
  }

  await execFileAsync(adb, ['-s', deviceId, 'forward', 'tcp:8080', 'tcp:8080'], {
    timeout: 8000,
    windowsHide: true,
    cwd,
  });
  try {
    await execFileAsync(adb, ['-s', deviceId, 'forward', 'tcp:8554', 'tcp:8554'], {
      timeout: 8000,
      windowsHide: true,
      cwd,
    });
  } catch {
    /* RTSP optional */
  }

  return {
    success: true,
    message: `Đã forward USB → localhost:8080 (thiết bị ${deviceId})`,
  };
}
