import { getMeta, putMeta } from './db.js';

const VAULT_KEY = 'vault';
const VERIFIER = 'inventaire-biens:verifier:v1';
const ITERATIONS = 310000;

let sessionKey = null;

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveKey(password, saltBuffer) {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuffer, iterations: ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptBuffer(keyRef, buffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyRef, buffer);
  return { iv: bufferToBase64(iv.buffer), ct: bufferToBase64(ct) };
}

async function decryptBuffer(keyRef, payload) {
  const iv = base64ToBuffer(payload.iv);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    keyRef,
    base64ToBuffer(payload.ct)
  );
  return plain;
}

export function isUnlocked() {
  return sessionKey !== null;
}

export async function vaultExists() {
  const vault = await getMeta(VAULT_KEY);
  return Boolean(vault);
}

export async function createVault(password) {
  if (await vaultExists()) {
    throw new Error('Un coffre existe déjà sur cet appareil.');
  }
  if (!password || password.length < 6) {
    throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
  }
  const saltBuffer = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const key = await deriveKey(password, saltBuffer);
  const check = await encryptBuffer(key, new TextEncoder().encode(VERIFIER).buffer);
  await putMeta({ k: VAULT_KEY, salt: bufferToBase64(saltBuffer), iterations: ITERATIONS, check });
  sessionKey = key;
}

export async function unlock(password) {
  const vault = await getMeta(VAULT_KEY);
  if (!vault) {
    throw new Error('Aucun coffre existant. Créez-le d’abord.');
  }
  const key = await deriveKey(password, base64ToBuffer(vault.salt));
  try {
    const plain = await decryptBuffer(key, vault.check);
    if (new TextDecoder().decode(plain) !== VERIFIER) {
      throw new Error('bad verifier');
    }
  } catch (error) {
    throw new Error('Mot de passe incorrect.');
  }
  sessionKey = key;
}

export function lock() {
  sessionKey = null;
}

export async function encryptJSON(obj) {
  if (!sessionKey) throw new Error('Coffre verrouillé.');
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return encryptBuffer(sessionKey, bytes.buffer);
}

export async function decryptJSON(payload) {
  if (!sessionKey) throw new Error('Coffre verrouillé.');
  const plain = await decryptBuffer(sessionKey, payload);
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function encryptBytes(buffer) {
  if (!sessionKey) throw new Error('Coffre verrouillé.');
  return encryptBuffer(sessionKey, buffer);
}

export async function decryptBytes(payload) {
  if (!sessionKey) throw new Error('Coffre verrouillé.');
  return decryptBuffer(sessionKey, payload);
}

export async function exportVaultMeta() {
  const vault = await getMeta(VAULT_KEY);
  if (!vault) throw new Error('Aucun coffre existant.');
  return vault;
}

export async function importVaultMeta(vault) {
  await putMeta({ k: VAULT_KEY, ...vault });
}
