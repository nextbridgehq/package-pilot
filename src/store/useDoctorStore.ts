import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DiagnosticResult } from "../services/tauriApi";

interface DoctorStore {
  results: DiagnosticResult[];
  hasRun: boolean;
  setResults: (results: DiagnosticResult[]) => void;
}

export const useDoctorStore = create<DoctorStore>()(
  persist(
    (set) => ({
      results: [],
      hasRun: false,
      setResults: (results) => set({ results, hasRun: true }),
    }),
    {
      name: "packagepilot-doctor-storage-v3",
    }
  )
);
