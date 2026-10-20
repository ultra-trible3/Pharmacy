import { Router } from 'express';
import { z } from 'zod';
import {
  createProductSchema,
  idSchema,
  productQuerySchema,
  setProductImageSchema,
  updateProductSchema,
} from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as productsService from './products.service.js';

export const productsRouter = Router();

productsRouter.use(authenticate);

const idParams = z.object({ id: idSchema });
const barcodeParams = z.object({ barcode: z.string().trim().min(1).max(64) });

productsRouter.get(
  '/',
  authorize('products:read'),
  validate({ query: productQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await productsService.listProducts(req.query as never, req.user!.role);
    res.status(200).json(result);
  }),
);

productsRouter.get(
  '/lookup/:barcode',
  authorize('products:read'),
  rateLimit({ name: 'products:lookup', windowMs: 60_000, max: 600 }),
  validate({ params: barcodeParams }),
  asyncHandler(async (req, res) => {
    const product = await productsService.lookupByBarcode(
      req.params.barcode as string,
      req.user!.role,
    );
    res.status(200).json(product);
  }),
);

productsRouter.post(
  '/barcodes/assign',
  authorize('products:write'),
  asyncHandler(async (req, res) => {
    const result = await productsService.assignMissingBarcodes(req.user!.id);
    res.status(200).json(result);
  }),
);

productsRouter.get(
  '/:id',
  authorize('products:read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const product = await productsService.getProduct(req.params.id as string, req.user!.role);
    res.status(200).json(product);
  }),
);

// --- Product photo ---------------------------------------------------------
// The bytes live under their own path so product list/detail payloads stay
// small; the desktop client fetches them only for the cards on screen.

productsRouter.get(
  '/:id/image',
  authorize('products:read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const image = await productsService.getProductImage(req.params.id as string);
    res.status(200).json(image);
  }),
);

productsRouter.put(
  '/:id/image',
  authorize('products:write'),
  validate({ params: idParams, body: setProductImageSchema }),
  asyncHandler(async (req, res) => {
    const result = await productsService.setProductImage(
      req.params.id as string,
      req.body,
      req.user!.id,
    );
    res.status(200).json(result);
  }),
);

productsRouter.delete(
  '/:id/image',
  authorize('products:write'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const result = await productsService.removeProductImage(req.params.id as string, req.user!.id);
    res.status(200).json(result);
  }),
);

productsRouter.post(
  '/',
  authorize('products:write'),
  validate({ body: createProductSchema }),
  asyncHandler(async (req, res) => {
    const product = await productsService.createProduct(req.body, req.user!.id, req.user!.role);
    res.status(201).json(product);
  }),
);

productsRouter.patch(
  '/:id',
  authorize('products:write'),
  validate({ params: idParams, body: updateProductSchema }),
  asyncHandler(async (req, res) => {
    const product = await productsService.updateProduct(
      req.params.id as string,
      req.body,
      req.user!.id,
      req.user!.role,
    );
    res.status(200).json(product);
  }),
);

productsRouter.delete(
  '/:id',
  authorize('products:delete'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const result = await productsService.deleteProduct(req.params.id as string, req.user!.id);
    res.status(result.deleted ? 200 : 200).json(result);
  }),
);
