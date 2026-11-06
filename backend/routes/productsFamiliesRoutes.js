// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsFamiliesRoutes.js — Famílias de Produtos (3º nível)         ║
// ║ Montadas em /api no server.js                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import productsFamiliesController from '../controllers/productsFamiliesController.js';

const router = Router();

router.get('/products-families', productsFamiliesController.list);
router.get('/products-families/:id', productsFamiliesController.getById);
router.post('/products-families', productsFamiliesController.create);
router.put('/products-families/:id', productsFamiliesController.update);
router.delete('/products-families/:id', productsFamiliesController.remove);

export default router;
