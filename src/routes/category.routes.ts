import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  createCategory,
  deleteCategory,
  getActiveCategories,
  getActiveCategoryById,
  getAllCategoriesForAdmin,
  getCategoryByIdForAdmin,
  getCategoryExperienceTypes,
  setCategoryExperienceTypes,
  updateCategory,
} from "../controllers/category.controller";
import { uploadCategoryImage } from "../controllers/category.controller";
import { upload } from "../middlewares/upload.middleware";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Public category routes
|--------------------------------------------------------------------------
*/

// Get all active service categories
router.get("/", getActiveCategories);

/*
|--------------------------------------------------------------------------
| Admin category routes
|--------------------------------------------------------------------------
| Keep these routes above the public /:id route.
|--------------------------------------------------------------------------
*/

// Get all categories, including inactive ones
router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllCategoriesForAdmin,
);
router.post(
  "/admin/upload-image",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  upload.single("image"),
  uploadCategoryImage,
);
// Get one category for admin
router.get(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getCategoryByIdForAdmin,
);

// Create a category
router.post(
  "/admin",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  createCategory,
);

// Update a category
router.patch(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateCategory,
);

// Delete an empty category
router.delete(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  deleteCategory,
);

// Get experience types linked to a category (with link status)
router.get(
  "/admin/:id/experience-types",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getCategoryExperienceTypes,
);

// Set (replace) the experience types linked to a category
router.put(
  "/admin/:id/experience-types",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  setCategoryExperienceTypes,
);

/*
|--------------------------------------------------------------------------
| Public category detail route
|--------------------------------------------------------------------------
| This route must remain last so "admin" is not treated as a category ID.
|--------------------------------------------------------------------------
*/

router.get("/:id", getActiveCategoryById);

export default router;
