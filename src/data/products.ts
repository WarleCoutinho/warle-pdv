import type { Product } from '../types/product';

/** Initial local catalog, copied into product storage on the first run. */
export const products: Product[] = [
  { id: 'guarana-amazonia', name: 'Guaraná da Amazônia', priceInCents: 1000, category: 'Bebidas', active: true, emoji: '🥤' },
  { id: 'cremosinho', name: 'Cremosinho', priceInCents: 500, category: 'Lanches', active: true, emoji: '🍦' },
  { id: 'guarana-500ml', name: 'Guaraná 500 ml', priceInCents: 800, category: 'Bebidas', active: true, emoji: '🧃' },
  { id: 'agua-mineral', name: 'Água mineral', priceInCents: 300, category: 'Bebidas', active: true, emoji: '💧' },
  { id: 'coxinha', name: 'Coxinha', priceInCents: 700, category: 'Lanches', active: true, emoji: '🥟' },
  { id: 'pao-de-queijo', name: 'Pão de queijo', priceInCents: 600, category: 'Lanches', active: true, emoji: '🧀' },
];

