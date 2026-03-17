# TODO - Fil d'Ariane console des vues

- [ ] Ajouter un helper de log visuel (breadcrumb) dans `src/App.jsx`
- [ ] Brancher un `useEffect` sur `activeTab` pour logger la vue courante (Search/Propose/Profile)
- [ ] Logger aussi les overlays/vues secondaires:
  - [ ] `AuthView` (utilisateur non connecté)
  - [ ] `Map` (quand `selectedSearchSpot` est actif)
  - [ ] `MapSearchView` (quand `searchMapOpen` est actif)
  - [ ] `WaitingView` implicite (quand `activeTab=propose` et `myActiveSpot` actif)
- [ ] Vérifier qu’on n’introduit pas de régression (logs uniquement, sans impact UI)
