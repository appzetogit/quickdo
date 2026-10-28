/**
 * Dish-level order quantity limits (minOrderQuantity / maxOrderQuantity) for
 * the admin food editor -- the same pair the restaurant's own item form has.
 *
 * The admin create/update and list paths never carried these: the editor had
 * the per-variant limits only, so a dish sold at one price could not be given
 * a minimum ("Rasgulla, at least 4") from admin at all. The logic is shared
 * with quick commerce (shared/foodQuantityLimits.js).
 */
import { FoodItem } from '../models/food.model.js';
import { createFoodQuantityLimits } from '../../shared/foodQuantityLimits.js';

export const {
    withFoodQuantityLimits,
    prepareFoodQuantityLimits,
    saveFoodQuantityLimits,
} = createFoodQuantityLimits(FoodItem);
