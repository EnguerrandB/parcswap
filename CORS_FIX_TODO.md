# TODO - Vérification Correction CORS

## ✅ Changements Appliqués

- [x] Modifier `authDomain` dans `parkswap/src/firebase.js`
  - Avant: `"parcswap.netlify.app"`
  - Après: `"parkswap-36bb2.firebaseapp.com"`
- [x] Mettre à jour la documentation `CORS_FIX.md`

## 📋 Tests à Effectuer

### Test Local (Development)

```bash
cd parkswap
npm run dev
```

**Checklist:**

- [ ] Ouvrir la console du navigateur (F12)
- [ ] Vérifier qu'il n'y a **AUCUNE** erreur CORS
- [ ] Vérifier qu'il n'y a **AUCUNE** erreur `net::ERR_FAILED`
- [ ] Vérifier que Firestore se connecte (pas de message "offline")
- [ ] Se connecter avec un compte
- [ ] Vérifier que les spots existants s'affichent
- [ ] Publier un nouveau spot
- [ ] Vérifier que le spot apparaît immédiatement
- [ ] Tester la synchronisation en temps réel (ouvrir 2 onglets)

### Test Production (Netlify)

```bash
cd parkswap
npm run build
# Puis déployer sur Netlify
```

**Checklist:**

- [ ] Déployer sur Netlify
- [ ] Ouvrir l'application déployée
- [ ] Ouvrir la console du navigateur (F12)
- [ ] Vérifier qu'il n'y a **AUCUNE** erreur CORS
- [ ] Vérifier qu'il n'y a **AUCUNE** erreur `net::ERR_FAILED`
- [ ] Vérifier que Firestore fonctionne
- [ ] Tester l'authentification (login/logout)
- [ ] Vérifier que les spots s'affichent
- [ ] Publier un nouveau spot
- [ ] Vérifier la synchronisation en temps réel

## 🔍 Que Vérifier dans la Console

### ✅ Bon Signe (ce que vous DEVEZ voir)

```
[Firebase] Connected to Firestore
```

### ❌ Mauvais Signe (ce que vous NE DEVEZ PAS voir)

```
Access to fetch at 'https://firestore.googleapis.com/...' has been blocked by CORS policy
net::ERR_FAILED
FirebaseError: Failed to get document because the client is offline
Could not reach Cloud Firestore backend
```

## 🚨 Configuration Firebase Console Requise

### Erreur: `auth/requests-from-referer-<domain>-are-blocked`

Si vous voyez cette erreur, c'est que le domaine n'est pas autorisé dans Firebase Console.

**Solution:**

1. **Aller sur Firebase Console:**
   - https://console.firebase.google.com
   - Sélectionner le projet `parkswap-36bb2`

2. **Autoriser les domaines:**
   - Authentication → Settings → Authorized domains
   - Cliquer sur "Add domain"
   - Ajouter les domaines suivants:
     - `localhost` (pour le développement local)
     - Votre domaine Netlify (ex: `parcswap.netlify.app`)
     - Tous les domaines de preview Netlify si nécessaire

3. **Vérifier les domaines autorisés:**
   - `localhost` doit être dans la liste
   - `parkswap-36bb2.firebaseapp.com` (déjà présent par défaut)
   - Votre domaine Netlify principal

### Si les Erreurs CORS Persistent

Si vous voyez encore des erreurs CORS après ces changements:

1. **Vider le cache du navigateur:**
   - Chrome: Ctrl+Shift+Delete → Cocher "Cached images and files"
   - Firefox: Ctrl+Shift+Delete → Cocher "Cache"

2. **Hard refresh:**
   - Ctrl+Shift+R (Windows/Linux)
   - Cmd+Shift+R (Mac)

3. **Vérifier les redirects Netlify:**
   - Les redirects dans `netlify.toml` doivent pointer vers `parkswap-36bb2.firebaseapp.com`

## 📝 Notes

- La correction principale était de changer `authDomain` de Netlify vers Firebase
- Les redirects Netlify restent nécessaires pour l'UI d'authentification
- Aucune modification côté Firebase Console n'est nécessaire
- La configuration Firestore par défaut est optimale

## 🎯 Résultat Attendu

Après cette correction:

- ✅ Aucune erreur CORS dans la console
- ✅ Firestore se connecte immédiatement
- ✅ Les données se synchronisent en temps réel
- ✅ L'application fonctionne parfaitement sur Netlify
