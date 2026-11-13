import { invoke } from "@tauri-apps/api/core";

export interface RouteModel {
  id: string;
  name: string;
}

export interface RouteProvider {
  id: string;
  name: string;
  models: RouteModel[];
}

export interface SlotEntry {
  providerId: string;
  modelId: string;
}

export interface ModelSlot {
  id: string;
  name: string;
  entries: SlotEntry[];
}

export const commandcodeRouteApi = {
  getMode: () => invoke<boolean>("get_commandcode_route_mode"),
  setMode: (enabled: boolean) =>
    invoke<boolean>("set_commandcode_route_mode", { enabled }),
  options: () => invoke<RouteProvider[]>("list_commandcode_route_options"),
  slots: () => invoke<ModelSlot[]>("list_commandcode_slots"),
  saveSlot: (slot: ModelSlot) =>
    invoke<ModelSlot[]>("save_commandcode_slot", { slot }),
  deleteSlot: (id: string) =>
    invoke<ModelSlot[]>("delete_commandcode_slot", { id }),
};
