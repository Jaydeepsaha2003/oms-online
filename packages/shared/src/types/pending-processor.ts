/** Pending Order Processor: what is loaded, for the page that downloads it. */
export interface PendingProcessorInfoDto {
  /** The lookup sheets (Settings + Vendor Details) taken from the processor workbook. */
  lookups: {
    fileName: string;
    loadedAt: string;
    loadedBy: string | null;
    /** Settings column A: a design containing one of these goes on ShopPenOrder. */
    shopKeywords: string[];
    shortNames: number;
    vendors: number;
  } | null;
  /** Lines the file would hold right now. */
  pendingLines: number;
}
