# 📦 Inventaire des biens

Application web (PWA) **locale et chiffrée** pour inventorier vos biens mobiliers :
photos, factures, pièces, montants, statistiques et dossier sinistre pour l'assurance.

## Pourquoi cette conception

- **100 % local** : les données vivent dans votre navigateur (IndexedDB), rien n'est envoyé sur Internet
- **Chiffrées** : AES-256-GCM, clé dérivée de votre mot de passe maître (PBKDF2, 310 000 itérations)
- **Verrouillage automatique** après 5 minutes d'inactivité
- **Sauvegarde chiffrée** : un fichier JSON chiffré que vous déposez dans iCloud Drive (ou tout autre cloud) — le cloud ne voit que des données illisibles
- **IA en option** : la reconnaissance photo (TensorFlow.js + MobileNet) tourne dans votre navigateur ; rien à installer, et en cas d'absence de réseau la saisie manuelle reste possible

## Lancer l'application

Un simple serveur de fichiers statiques suffit (aucune installation, aucune base de données) :

```bash
python3 -m http.server 8000
```

ou, avec Node.js :

```bash
npx serve .
```

Ouvrez ensuite http://localhost:8000, créez votre coffre (mot de passe maître) et commencez.

### Installer comme application

- **PC (Chrome/Edge)** : menu ⋮ → « Installer Inventaire des biens » — l'app aura son icône et sa fenêtre
- **iPhone/iPad** : ouvrez l'adresse dans Safari → bouton Partager → « Sur l'écran d'accueil »

> ⚠️ Sur mobile, ouvrez l'application via une adresse HTTPS (le mode « installable » de la PWA l'exige).
> Sur le PC en `http://localhost` tout fonctionne déjà, y compris le service worker (mode hors ligne).

## Utilisation

1. **Créer le coffre** : premier lancement, choisissez un mot de passe maître (perdu = données irrécupérables, par conception)
2. **Ajouter un bien** : ＋ Ajouter → prenez/choisissez une photo → l'IA propose catégorie et nom → complétez pièce, date d'achat, prix → la valeur estimée est suggérée automatiquement
3. **Factures** : joignez un ou plusieurs PDF ou photos par bien
4. **Statistiques** : onglet dédié — valeur totale, par pièce, par catégorie, par année d'achat
5. **Regroupements et filtres** : recherche texte, pièce, catégorie, année, statut ; regroupement par pièce/catégorie/année ; tris par valeur, prix ou date
6. **Sauvegarde** : onglet Sauvegarde → « Créer la sauvegarde » → enregistrez le fichier dans votre dossier iCloud Drive
7. **Dossier sinistre** : onglet Sauvegarde → génère un document imprimable (photo, montants, factures) à joindre à votre déclaration d'assurance — « Enregistrer au format PDF »

## Sécurité — ce qui est garanti / non garanti

| Garanti | Non garanti |
|---|---|
| Données chiffrées au repos sur l'appareil | Un mot de passe maître trop faible peut être deviné (utilisez-en un long) |
| Fichier de sauvegarde illisible sans le mot de passe | La protection contre un logiciel malveillant déjà présent sur l'appareil |
| Aucune donnée ne transite par un service tiers | Le service worker hors ligne n'actif que sur HTTPS/localhost |
| Verrouillage auto après 5 min d'inactivité | — |

## Limites actuelles (prototype)

- La reconnaissance IA (MobileNet) couvre les objets courants ImageNet ; les catégories plus spécifiques tombent en « Autre »
- Pas d'OCR des factures (extraction date/montant) — prévu en prochaine étape
- Le changement de mot de passe maître passe par sauvegarde → effacement → restauration
- Une seule résidence (champ « pièce » librement nommable sinon)

## Développement

```bash
node test/smoke.test.mjs   # tests unitaires (crypto, estimation, classification, IndexedDB simulée)
```

Structure :

```
index.html              Interface (écran de verrouillage, inventaire, stats, sauvegarde)
css/style.css           Style
js/constants.js         Catégories, pièces, statuts
js/crypto.js            Coffre-fort : PBKDF2 + AES-256-GCM
js/db.js                IndexedDB : enregistrements chiffrés + fichiers
js/ai.js                Reconnaissance photo (TensorFlow.js/MobileNet chargé à la demande)
js/estimate.js          Règles de décote par catégorie
js/app.js               Logique d'interface
sw.js                   Service worker (mode hors ligne)
manifest.webmanifest    Manifest PWA
```
