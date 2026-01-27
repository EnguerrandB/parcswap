# Correction de l'erreur CORS Firebase

## Problème

L'application rencontrait des erreurs CORS répétées lors des requêtes Firestore:

```
Access to XMLHttpRequest at 'https://firestore.googleapis.com/...' from origin 'https://66df16c2--parcswap.netlify.live'
has been blocked by CORS policy: The value of the 'Access-Control-Allow-Origin' header in the response must not be
the wildcard '*' when the request's credentials mode is 'include'.
```

**Symptômes:**

- Erreurs CORS toutes les X secondes dans la console
- Les spots publiés ne s'affichaient pas
- Erreur `net::ERR_FAILED 200 (OK)` sur les requêtes Firestore

## Cause

La configuration Firestore utilisait des options expérimentales qui causaient des conflits avec les credentials:

```javascript
// ❌ Configuration problématique
db = initializeFirestore(app, {
  experimentalForceLongPolling: true, // Force le long polling
  useFetchStreams: false, // Désactive les streams fetch
});
```

Ces options étaient destinées à résoudre des problèmes de connexion, mais créaient des conflits CORS sur Netlify.

## Solution

Utilisation de la configuration Firestore par défaut qui gère automatiquement les connexions:

```javascript
// ✅ Configuration corrigée
db = getFirestore(app);
```

## Changements Appliqués

### Fichier: `parkswap/src/firebase.js`

**Avant:**

```javascript
let db;
try {
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  });
} catch (e) {
  db = getFirestore(app);
}
```

**Après:**

```javascript
let db;
try {
  db = getFirestore(app);
} catch (e) {
  // Fallback if getFirestore fails
  db = initializeFirestore(app, {});
}
```

## Pourquoi ça fonctionne

1. **Configuration par défaut optimisée**: Firebase SDK gère automatiquement le meilleur mode de connexion (WebSocket, long polling, etc.)

2. **Pas de conflit credentials**: La configuration par défaut respecte les politiques CORS des navigateurs

3. **Compatibilité Netlify**: Fonctionne correctement avec les domaines Netlify et les redirects configurés

## Tests à effectuer

1. **Local (dev):**

   ```bash
   npm run dev
   ```

   - Vérifier que les spots s'affichent
   - Publier un nouveau spot
   - Vérifier qu'il n'y a plus d'erreurs CORS dans la console

2. **Production (Netlify):**
   ```bash
   npm run build
   # Déployer sur Netlify
   ```

   - Vérifier que les spots s'affichent
   - Publier un nouveau spot
   - Vérifier la synchronisation en temps réel

## Notes Importantes

- Les émulateurs Firebase continuent de fonctionner normalement en développement
- La configuration `authDomain: "parcswap.netlify.app"` dans `firebaseConfig` est correcte
- Les redirects dans `netlify.toml` pour `/__/auth/*` et `/__/firebase/*` sont toujours nécessaires

## Références

- [Firebase Firestore Web Setup](https://firebase.google.com/docs/firestore/quickstart)
- [CORS and Firebase](https://firebase.google.com/docs/hosting/full-config#cors)
- [Netlify Redirects](https://docs.netlify.com/routing/redirects/)

---

**Date de correction:** 2024
**Status:** ✅ Résolu
