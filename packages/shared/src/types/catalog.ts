/** Catalog shapes: products, designs, design names and combinations. */

import type { Paginated, PaginationQuery } from './common';
import type { CategoryFieldDto } from './order';

export interface ProductDto {
  id: number;
  code: string | null;
  category: string;
  subCategory: string;
  product: string;
  size: number | null;
  weight: number | null;
  pcs: number | null;
  rate: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  category: string;
  subCategory: string;
  product: string;
  size?: number | null;
  weight?: number | null;
  pcs?: number | null;
  rate?: number | null;
}

export interface DesignDto {
  id: number;
  code: string | null;
  category: string;
  subCategory: string;
  designType: string;
  cost: number | null;
  rate: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignInput {
  category: string;
  subCategory: string;
  designType: string;
  cost?: number | null;
  rate?: number | null;
}

export interface DesignNameDto {
  id: number;
  designType: string;
  designName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignNameInput {
  designType: string;
  designName: string;
}

/** A design that is part of a combination (with its own cost/rate). */
export interface CombinationDesignLite {
  id: number;
  code: string | null;
  category: string;
  subCategory: string;
  designType: string;
  cost: number | null;
  rate: number | null;
}

export interface CombinationDto {
  id: number;
  code: string | null;
  /** Auto-built from the component design types (e.g. "DL + LOGO"); editable. */
  name: string;
  /** Distinct category / sub-category of the component designs (comma-joined when mixed). */
  category: string;
  subCategory: string;
  designs: CombinationDesignLite[];
  /** Live sum of the component designs' cost / rate. */
  cost: number;
  rate: number;
  createdAt: string;
  updatedAt: string;
}

/** Create/update a combination from a set of designs. */
export interface CombinationInput {
  name?: string | null;
  designIds: number[];
}

/** Existing distinct values to populate the product form's category dropdowns. */
export interface ProductLookups {
  categories: string[];
  subCategories: string[];
  /** Per-category price calculation field (KGS / PCS). */
  categoryFields: CategoryFieldDto[];
}

/** Existing distinct values to populate the design form's category dropdowns. */
export interface DesignLookups {
  categories: string[];
  subCategories: string[];
}

export type ProductQuery = PaginationQuery;
export type DesignQuery = PaginationQuery;
export type DesignNameQuery = PaginationQuery;
export type CombinationQuery = PaginationQuery;

export type ProductList = Paginated<ProductDto>;
export type DesignList = Paginated<DesignDto>;
export type DesignNameList = Paginated<DesignNameDto>;
export type CombinationList = Paginated<CombinationDto>;
