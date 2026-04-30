# Guide de Configuration : Version Gratuite vs Payante

## 🎯 Présentation

ParkSwap peut maintenant fonctionner en deux modes :

- **Version GRATUITE** : aucun paiement, wallet, ni prix affichés
- **Version PAYANTE** : avec wallet, paiements (Stripe/IAP iOS), et prix des spots

## 📁 Fichiers créés

### Configuration

- `.env.free` - Variables d'environnement pour la version gratuite
- `.env.paid` - Variables d'environnement pour la version payante
- `src/config/features.js` - Feature flags centralisés

## 🚀 Lancer les différentes versions

### En développement

```bash
# Version GRATUITE
npm run dev:free

# Version PAYANTE (par défaut)
npm run dev:paid
# ou simplement
npm run dev
```

### Build pour production

```bash
# Version GRATUITE
npm run build:free

# Version PAYANTE
npm run build:paid
```

### Preview

```bash
npm run preview:free
npm run preview:paid
```

## ⚙️ Variables d'environnement

### `.env.free` (Version gratuite)

```env
VITE_PAYMENT_ENABLED=false
VITE_SHOW_WALLET=false
VITE_SHOW_PRICES=false
VITE_APP_ID=parkswap-free
```

### `.env.paid` (Version payante)

```env
VITE_PAYMENT_ENABLED=true
VITE_SHOW_WALLET=true
VITE_SHOW_PRICES=true
VITE_APP_ID=parkswap-paid
```

## 📝 Modifications effectuées

### Fichiers modifiés

1. **`package.json`**
   - Ajout des scripts `dev:free`, `dev:paid`, `build:free`, `build:paid`

2. **`vite.config.js`**
   - Support des modes `free` et `paid`
   - Chargement automatique des variables d'environnement

3. **`src/config/features.js`** (nouveau)
   - Feature flags : `PAYMENT_ENABLED`, `SHOW_WALLET`, `SHOW_PRICES`
   - Utilitaires : `isPaymentEnabled()`, `shouldShowWallet()`, `shouldShowPrices()`

4. **`src/App.jsx`**
   - Import des feature flags
   - `walletTopupModeFromContext()` retourne `'disabled'` si paiements désactivés
   - Texte onboarding conditionnel (avec/sans mention du wallet)

5. **`src/views/ProfileView.jsx`**
   - Section Wallet conditionnelle (affichée uniquement si `SHOW_WALLET === true`)

6. **`src/views/ProposeView.jsx`**
   - Section Prix conditionnelle (affichée uniquement si `SHOW_PRICES === true`)
   - Prix par défaut = 0 en mode gratuit

## 🔧 Build pour mobile (iOS/Android)

### Version gratuite

```bash
cd parkswap
npm run build:free
cd ../parkswap-mobile
npm run sync:ios    # ou sync:android
```

### Version payante

```bash
cd parkswap
npm run build:paid
cd ../parkswap-mobile
npm run sync:ios    # ou sync:android
```

## 📱 Différences entre les versions

| Fonctionnalité  | Gratuit                 | Payant                |
| --------------- | ----------------------- | --------------------- |
| Wallet          | ❌ Masqué               | ✅ Visible            |
| Prix des spots  | ❌ Masqué (toujours 0€) | ✅ Configurable 0-20€ |
| Recharge Stripe | ❌ Désactivé            | ✅ Actif              |
| IAP iOS         | ❌ Désactivé            | ✅ Actif              |
| Transactions    | ✅ Visible              | ✅ Visible            |
| Historique      | ✅ Visible              | ✅ Visible            |

## 🎨 Personnalisation

Pour ajouter d'autres feature flags :

1. Ajouter la variable dans `.env.free` et `.env.paid`
2. Déclarer le flag dans `src/config/features.js`
3. Utiliser le flag dans vos composants

Exemple :

```javascript
// src/config/features.js
export const SHOW_ADS = parseEnvBoolean(import.meta.env.VITE_SHOW_ADS, false);

// Dans un composant
import { SHOW_ADS } from "../config/features";

{
  SHOW_ADS && <BannerAd />;
}
```

## 🔍 Debug

Pour vérifier la configuration au démarrage, ouvrez la console :

```
[ParkSwap Config] {
  PAYMENT_ENABLED: false,
  SHOW_WALLET: false,
  SHOW_PRICES: false,
  mode: 'FREE'
}
```

## 🚨 Important

- Les fichiers `.env.*.local` sont ignorés par Git (pour les secrets locaux)
- Ne committez JAMAIS de clés API ou tokens dans les fichiers `.env`
- Vérifiez toujours le mode avant de déployer en production
- Les IAP iOS nécessitent une configuration spécifique dans App Store Connect

## 📦 Déploiement

### Netlify (web)

Configurez les variables d'environnement dans les settings Netlify :

- `VITE_PAYMENT_ENABLED=true/false`
- `VITE_SHOW_WALLET=true/false`
- `VITE_SHOW_PRICES=true/false`

### App Store / Google Play

Créez deux apps distinctes :

- **ParkSwap Free** (version gratuite)
- **ParkSwap** (version payante avec IAP)

Ou utilisez la même app avec un feature flag côté serveur.
