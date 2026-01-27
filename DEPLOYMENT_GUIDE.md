# Guide de Déploiement - ParkSwap

## Déploiement sur Netlify

### Prérequis

- Compte Netlify
- Repository Git connecté
- Variables d'environnement Firebase configurées

### Étapes de Déploiement

#### 1. Build Local (Test)

```bash
cd parkswap
npm run build
```

Vérifier que le build se termine sans erreurs.

#### 2. Déploiement via Netlify CLI

**Installation:**

```bash
npm install -g netlify-cli
```

**Login:**

```bash
netlify login
```

**Déploiement:**

```bash
cd parkswap
netlify deploy --prod
```

#### 3. Déploiement via Git (Recommandé)

**Commit des changements:**

```bash
git add .
git commit -m "fix: Résolution erreur CORS Firebase"
git push origin main
```

Netlify déploiera automatiquement les changements.

### Configuration Netlify

#### Build Settings

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Node version:** 18.x ou supérieur

#### Redirects (déjà configurés dans netlify.toml)

```toml
[[redirects]]
  from = "/__/auth/*"
  to = "https://parkswap-36bb2.firebaseapp.com/__/auth/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/__/firebase/*"
  to = "https://parkswap-36bb2.firebaseapp.com/__/firebase/:splat"
  status = 200
  force = true
```

### Vérifications Post-Déploiement

#### 1. Console Browser (F12)

✅ **Pas d'erreurs CORS:**

```
❌ AVANT: Access to XMLHttpRequest... blocked by CORS policy
✅ APRÈS: Aucune erreur CORS
```

#### 2. Fonctionnalités

- [ ] Les spots existants s'affichent
- [ ] Possibilité de publier un nouveau spot
- [ ] Le spot publié apparaît immédiatement
- [ ] La synchronisation temps réel fonctionne
- [ ] Les notifications de réservation fonctionnent

#### 3. Performance

- [ ] Temps de chargement < 3s
- [ ] Pas de latence sur les mises à jour Firestore
- [ ] Les images se chargent correctement

### Rollback en Cas de Problème

#### Via Netlify Dashboard

1. Aller sur le site Netlify
2. Deploys → Cliquer sur un déploiement précédent
3. "Publish deploy"

#### Via CLI

```bash
netlify rollback
```

### Monitoring

#### Logs Netlify

```bash
netlify logs
```

#### Firebase Console

- Vérifier les métriques Firestore
- Surveiller les erreurs dans Functions
- Vérifier l'authentification

### Domaines

#### Production

- **Netlify:** `https://parcswap.netlify.app`
- **Custom (si configuré):** `https://parkswap.app`

#### Preview Deploys

- Format: `https://[deploy-id]--parcswap.netlify.app`
- Créés automatiquement pour chaque PR

### Variables d'Environnement

Les clés Firebase sont publiques (côté client), donc pas besoin de variables d'environnement secrètes pour:

- `apiKey`
- `authDomain`
- `projectId`
- etc.

**Note:** Les clés API Firebase sont sécurisées par les règles Firestore et les domaines autorisés.

### Troubleshooting

#### Erreur: "Build failed"

```bash
# Nettoyer et rebuilder
rm -rf node_modules dist
npm install
npm run build
```

#### Erreur: "Function timeout"

- Vérifier les Firebase Functions logs
- Augmenter le timeout si nécessaire

#### Erreur: "CORS persiste"

1. Vider le cache du navigateur
2. Vérifier que `firebase.js` utilise `getFirestore(app)`
3. Vérifier les redirects dans `netlify.toml`

### Commandes Utiles

```bash
# Status du site
netlify status

# Ouvrir le site
netlify open

# Ouvrir le dashboard
netlify open:admin

# Logs en temps réel
netlify logs --live

# Liste des déploiements
netlify deploy --list
```

### Checklist Finale

Avant de marquer le déploiement comme réussi:

- [ ] ✅ Pas d'erreurs CORS dans la console
- [ ] ✅ Les spots s'affichent correctement
- [ ] ✅ Publication de spots fonctionne
- [ ] ✅ Synchronisation temps réel active
- [ ] ✅ Authentification fonctionne
- [ ] ✅ Navigation fluide
- [ ] ✅ Responsive sur mobile
- [ ] ✅ Performance acceptable (< 3s)

---

**Dernière mise à jour:** 2024
**Version:** 1.0.0
