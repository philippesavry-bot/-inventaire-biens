import assert from 'node:assert/strict';
import { installMock, resetMock } from './idb-mock.js';

installMock();

const { estimateValue, estimateExplanation } = await import('../js/estimate.js');
const { classifyPredictions } = await import('../js/ai.js');
const crypto = await import('../js/crypto.js');
const db = await import('../js/db.js');

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(`✓ ${name}`))
    .catch((error) => {
      results.push(`✗ ${name} : ${error.message}`);
      process.exitCode = 1;
    });
}

await check('estimation: électronique de 1000 € avec 1 an d\'âge → 800 €', () => {
  const value = estimateValue({
    price: 1000,
    category: 'Électronique',
    purchaseDate: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  });
  assert.equal(value, 800);
});

await check('estimation: plancher de décote respecté (15 %)', () => {
  const value = estimateValue({
    price: 1000,
    category: 'Électronique',
    purchaseDate: '2005-01-01'
  });
  assert.equal(value, 150);
});

await check('estimation: bijoux conservés à la valeur d\'achat', () => {
  const value = estimateValue({ price: 2000, category: 'Bijoux & montres', purchaseDate: '1990-06-15' });
  assert.equal(value, 2000);
});

await check('estimation: sans prix → null', () => {
  assert.equal(estimateValue({ price: null, category: 'Mobilier' }), null);
});

await check('estimation: explication non vide', () => {
  const value = estimateValue({ price: 500, category: 'Mobilier', purchaseDate: '2024-01-01' });
  assert.ok(estimateExplanation({ price: 500, category: 'Mobilier', purchaseDate: '2024-01-01' }, value).length > 10);
});

await check('IA: téléphone → Électronique + suggestion de nom', () => {
  const result = classifyPredictions([{ className: 'cellular telephone, cellphone', probability: 0.7 }]);
  assert.equal(result.category, 'Électronique');
  assert.equal(result.suggestion, 'Cellular telephone');
});

await check('IA: guitare → Musique', () => {
  const result = classifyPredictions([{ className: 'electric guitar', probability: 0.6 }]);
  assert.equal(result.category, 'Musique');
});

await check('IA: étiquette inconnue → Autre', () => {
  const result = classifyPredictions([{ className: 'lawn mower', probability: 0.9 }]);
  assert.equal(result.category, 'Outils');
});

await check('IA: rien de reconnu → catégorie Autre avec label principal', () => {
  const result = classifyPredictions([{ className: 'carton', probability: 0.5 }]);
  assert.equal(result.category, 'Autre');
  assert.equal(result.suggestion, 'Carton');
});

await new Promise((r) => setTimeout(r, 30));

await check('DB: meta put/get', async () => {
  await db.putMeta({ k: 'test', a: 1 });
  const meta = await db.getMeta('test');
  assert.equal(meta.a, 1);
});

await check('crypto: création de coffre + verrouillage session', async () => {
  assert.equal(await crypto.vaultExists(), false);
  await crypto.createVault('mot-de-passe-1');
  assert.equal(await crypto.vaultExists(), true);
  assert.equal(crypto.isUnlocked(), true);
});

await check('crypto: aller-retour JSON chiffré', async () => {
  const payload = await crypto.encryptJSON({ nom: 'Télé', prix: 499.99, photos: [{ id: 'a' }] });
  assert.ok(payload.iv && payload.ct);
  const plain = await crypto.decryptJSON(payload);
  assert.equal(plain.nom, 'Télé');
  assert.equal(plain.prix, 499.99);
  assert.equal(plain.photos[0].id, 'a');
});

await check('crypto: aller-retour binaire chiffré', async () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(64)).buffer;
  const payload = await crypto.encryptBytes(bytes);
  const out = await crypto.decryptBytes(payload);
  assert.deepEqual(new Uint8Array(out), new Uint8Array(bytes));
});

await check('crypto: mauvais mot de passe refusé', async () => {
  crypto.lock();
  await assert.rejects(() => crypto.unlock('mauvais'), /Mot de passe incorrect/);
  assert.equal(crypto.isUnlocked(), false);
});

await check('crypto: bon mot de passe accepté', async () => {
  await crypto.unlock('mot-de-passe-1');
  assert.equal(crypto.isUnlocked(), true);
});

await check('DB: enregistrements items', async () => {
  await db.putRecord({ id: 'item:1', type: 'item', iv: 'x', ct: 'y' });
  await db.putRecord({ id: 'file:1', type: 'file', mime: 'image/jpeg', iv: 'x', ct: 'y' });
  const all = await db.getAllRecords();
  assert.equal(all.length, 2);
  await db.deleteRecord('file:1');
  const after = await db.getAllRecords();
  assert.equal(after.length, 1);
  await db.clearAll();
  assert.equal((await db.getAllRecords()).length, 0);
});

await check('DB: deleteMeta supprime le coffre', async () => {
  await db.deleteMeta('test');
  assert.equal(await db.getMeta('test'), undefined);
});

console.log(results.join('\n'));
if (process.exitCode) process.exit(process.exitCode);
