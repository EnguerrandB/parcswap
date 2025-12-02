// src/constants.js

export const MOCK_CARS = [
  { id: 1, model: 'Range Rover', plate: 'AB-123-CD' },
  { id: 2, model: 'Tesla Model 3', plate: 'XY-987-ZZ' },
];

// Format currency
export const formatPrice = (price) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(price);