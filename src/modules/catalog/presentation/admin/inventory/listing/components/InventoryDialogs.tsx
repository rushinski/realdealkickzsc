"use client";

import type {
  InventoryDialogsActions,
  InventoryDialogsState,
} from "@/modules/catalog/presentation/admin/inventory/listing/inventoryClientContracts";
import { InventoryArchiveDialog } from "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryArchiveDialog";
import { InventoryDeleteDialogs } from "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryDeleteDialogs";
import { InventoryProductDetailsModal } from "@/modules/catalog/presentation/admin/inventory/listing/details/InventoryProductDetailsModal";
import { InventoryRestoreDialog } from "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryRestoreDialog";
import { Toast } from "@/components/ui/Toast";

type InventoryDialogsProps = InventoryDialogsState & InventoryDialogsActions;

export function InventoryDialogs({
  detailsSelection,
  pendingDelete,
  pendingMassDelete,
  pendingArchive,
  pendingRestore,
  selectedCount,
  toast,
  onCloseDetails,
  onConfirmDelete,
  onCancelDelete,
  onConfirmMassDelete,
  onCancelMassDelete,
  onConfirmArchive,
  onCancelArchive,
  onConfirmRestore,
  onCancelRestore,
  onCloseToast,
}: InventoryDialogsProps) {
  return (
    <>
      <InventoryProductDetailsModal
        open={Boolean(detailsSelection)}
        product={detailsSelection?.product ?? null}
        variant={detailsSelection?.variant ?? null}
        onClose={onCloseDetails}
      />
      <InventoryDeleteDialogs
        pendingDelete={pendingDelete}
        pendingMassDelete={pendingMassDelete}
        selectedCount={selectedCount}
        onConfirmDelete={onConfirmDelete}
        onCancelDelete={onCancelDelete}
        onConfirmMassDelete={onConfirmMassDelete}
        onCancelMassDelete={onCancelMassDelete}
      />
      <InventoryArchiveDialog
        pendingArchive={pendingArchive}
        selectedCount={selectedCount}
        onConfirm={onConfirmArchive}
        onCancel={onCancelArchive}
      />
      <InventoryRestoreDialog
        pendingRestore={pendingRestore}
        selectedCount={selectedCount}
        onConfirm={onConfirmRestore}
        onCancel={onCancelRestore}
      />

      <Toast
        open={Boolean(toast)}
        message={toast?.message ?? ""}
        tone={toast?.tone ?? "info"}
        onClose={onCloseToast}
      />
    </>
  );
}
