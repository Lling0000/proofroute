import { execFile } from 'node:child_process';

const NVIDIA_SMI_ARGS = [
  '--query-gpu=index,name,memory.total,driver_version',
  '--format=csv,noheader,nounits'
];

export async function detectNvidiaDeviceProfiles({ devices = [], timeoutMs = 120, command = 'nvidia-smi' } = {}) {
  const selectedDevices = normalizeDeviceList(devices);
  const safeTimeoutMs = normalizeTimeout(timeoutMs);
  return new Promise((resolve) => {
    execFile(command, NVIDIA_SMI_ARGS, { timeout: safeTimeoutMs }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(filterDeviceProfiles(parseNvidiaSmiCsv(stdout), selectedDevices));
    });
  });
}

export function parseNvidiaSmiCsv(text) {
  return String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(parseNvidiaSmiRow).filter(Boolean);
}

export function filterDeviceProfiles(profiles, devices = []) {
  const selected = normalizeDeviceList(devices);
  if (selected.length === 0) return profiles;
  const wanted = new Set(selected);
  return profiles.filter((profile) => wanted.has(profile.id));
}

export function normalizeDeviceList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseNvidiaSmiRow(line) {
  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 4) return undefined;
  const [id, name, memory, driver] = parts;
  const memoryMb = Number(memory);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    ...(Number.isFinite(memoryMb) ? { memoryMb } : {}),
    runtime: 'CUDA',
    ...(driver ? { driver } : {}),
    source: 'nvidia-smi'
  };
}

function normalizeTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}
