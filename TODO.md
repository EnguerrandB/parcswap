# TODO - Logs erreur booking INTERNAL (FR + emojis)

- [x] Ajouter des logs de pré-appel Cloud Function dans `handleBookSpot` (`src/App.jsx`)
- [x] Ajouter des logs d’erreur enrichis dans le `catch` de `handleBookSpot`:
  - [x] contexte booking (spot, user, session, opId, véhicule)
  - [x] détails Firebase (`code`, `message`, `details`, `name`, `stack`)
  - [x] code normalisé renvoyé au front
- [x] Utiliser des messages en français avec des indications claires et des emojis
- [x] Vérifier qu’aucun comportement métier n’est modifié (observabilité uniquement)
