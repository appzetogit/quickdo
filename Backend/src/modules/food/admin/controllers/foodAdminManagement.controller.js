import * as managementService from '../services/foodAdminManagementService.js';
import { sendResponse } from '../../../../utils/response.js';

export const listFoodAdminPermissions = async (req, res, next) => {
  try {
    const results = await managementService.listFoodAdminPermissions(req);
    return sendResponse(res, 200, 'Permissions listed successfully', results);
  } catch (error) {
    next(error);
  }
};

export const listAssignableFoodZones = async (req, res, next) => {
  try {
    const results = await managementService.listAssignableFoodZones(req.adminContext);
    return sendResponse(res, 200, 'Assignable zones listed successfully', results);
  } catch (error) {
    next(error);
  }
};

export const listFoodAdmins = async (req, res, next) => {
  try {
    const results = await managementService.listFoodAdmins(req.admin, req.query);
    return sendResponse(res, 200, 'Admins listed successfully', results);
  } catch (error) {
    next(error);
  }
};

export const getFoodAdminById = async (req, res, next) => {
  try {
    const result = await managementService.getFoodAdminById(req.admin, req.params.id);
    return sendResponse(res, 200, 'Admin details retrieved successfully', result);
  } catch (error) {
    next(error);
  }
};

export const createFoodAdminAccount = async (req, res, next) => {
  try {
    const result = await managementService.createFoodAdminAccount(req.admin, req.body);
    return sendResponse(res, 201, 'Subadmin created successfully', result);
  } catch (error) {
    next(error);
  }
};

export const updateFoodAdminAccount = async (req, res, next) => {
  try {
    const result = await managementService.updateFoodAdminAccount(req.admin, req.params.id, req.body);
    return sendResponse(res, 200, 'Admin updated successfully', result);
  } catch (error) {
    next(error);
  }
};

export const deleteFoodAdminAccount = async (req, res, next) => {
  try {
    const result = await managementService.deleteFoodAdminAccount(req.admin, req.params.id);
    return sendResponse(res, 200, 'Admin deleted successfully', result);
  } catch (error) {
    next(error);
  }
};
