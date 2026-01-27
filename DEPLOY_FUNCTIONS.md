# Déploiement des Cloud Functions avec correction CORS

## Problème résolu

Les Cloud Functions `bookSpotSecure`, `createKycSession` et `createWalletTopupSession` ont été mises à jour pour activer CORS avec l'option `cors: true`.

## Étapes de déploiement

### 1. Installer Firebase CLI (si pas déjà fait)

```bash
npm install -g firebase-tools
```

### 2. Se connecter à Firebase

```bash
firebase login
```

### 3. Vérifier le projet actif

```bash
firebase projects:list
firebase use parkswap-36bb2
```

### 4. Installer les dépendances des functions

```bash
cd functions
npm install
cd ..
```

### 5. Déployer uniquement les Cloud Functions

```bash
firebase deploy --only functions
```

Ou pour déployer une fonction spécifique:

```bash
firebase deploy --only functions:bookSpotSecure
firebase deploy --only functions:createKycSession
firebase deploy --only functions:createWalletTopupSession
```

### 6. Vérifier le déploiement

Après le déploiement, vous devriez voir:

```
✔  functions[bookSpotSecure(us-central1)] Successful update operation.
✔  functions[createKycSession(us-central1)] Successful update operation.
✔  functions[createWalletTopupSession(us-central1)] Successful update operation.
```

### 7. Tester l'application

1. Ouvrir l'application sur Netlify: `https://66df16c2--parcswap.netlify.live`
2. Essayer de réserver un spot
3. Vérifier qu'il n'y a plus d'erreur CORS dans la console

## Changements appliqués

### Avant:

```javascript
exports.bookSpotSecure = functions.https.onCall(async (data, context) => {
  // ...
});
```

### Après:

```javascript
exports.bookSpotSecure = functions
  .runWith({
    cors: true,
  })
  .https.onCall(async (data, context) => {
    // ...
  });
```

## Alternative: Configuration CORS manuelle

Si `cors: true` ne suffit pas, vous pouvez aussi configurer CORS manuellement dans `firebase.json`:

```json
{
  "functions": {
    "cors": {
      "origin": [
        "https://parcswap.netlify.app",
        "https://66df16c2--parcswap.netlify.live",
        "http://localhost:5173",
        "http://localhost:3000"
      ],
      "methods": ["GET", "POST", "OPTIONS"],
      "allowedHeaders": ["Content-Type", "Authorization"]
    }
  }
}
```

## Vérification des logs

Pour voir les logs des functions en temps réel:

```bash
firebase functions:log --only bookSpotSecure
```

## Rollback en cas de problème

Si le déploiement cause des problèmes:

```bash
firebase functions:delete bookSpotSecure
# Puis redéployer la version précédente
```

## Notes importantes

- Le déploiement peut prendre 2-5 minutes
- Les anciennes instances de la fonction seront automatiquement remplacées
- Aucune interruption de service n'est attendue
- Les fonctions `onCall` de Firebase gèrent automatiquement CORS quand `cors: true` est activé

## Résolution de problèmes

### Erreur: "Permission denied"

```bash
firebase login --reauth
```

### Erreur: "Project not found"

```bash
firebase use --add
# Sélectionner parkswap-36bb2
```

### Erreur: "Functions deployment failed"

Vérifier les logs:

```bash
firebase functions:log
```

---

**Date:** 2024
**Status:** ✅ Prêt pour déploiement
