# 🎯 Quick Start : Versions Gratuite et Payante

## Lancer en développement

```bash
# Version GRATUITE (sans paiements)
npm run dev:free

# Version PAYANTE (avec paiements)
npm run dev:paid
```

Vous verrez dans la console :

```
🚀 Building in mode: free
💰 Payment enabled: false
```

## Build pour production

```bash
npm run build:free   # Version gratuite
npm run build:paid   # Version payante
```

## Ce qui change entre les versions

### Version GRATUITE

- ❌ Pas de wallet
- ❌ Pas de prix sur les spots (toujours 0€)
- ❌ Pas de recharge Stripe/IAP
- ✅ Toutes les autres fonctionnalités

### Version PAYANTE

- ✅ Wallet visible et fonctionnel
- ✅ Prix configurables (0-20€)
- ✅ Recharge Stripe (web) ou IAP (iOS)
- ✅ Toutes les fonctionnalités

## 📖 Documentation complète

Voir [CONFIG_VERSIONS.md](./CONFIG_VERSIONS.md) pour tous les détails.
