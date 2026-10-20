import React, { createContext, useContext, useState } from "react";
type DemoState = {
  name: string;
  setName: (value: string) => void;
  target: string;
  setTarget: (value: string) => void;
  completedToday: boolean;
  setCompletedToday: (value: boolean) => void;
  saved: string[];
  toggleSaved: (id: string) => void;
  mastered: string[];
  toggleMastered: (id: string) => void;
};
const Context = createContext<DemoState | null>(null);
export function DemoProvider({ children }: React.PropsWithChildren) {
  const [name, setName] = useState("Hayden");
  const [target, setTarget] = useState("Product Designer");
  const [completedToday, setCompletedToday] = useState(false);
  const [saved, setSaved] = useState<string[]>(["e1", "q1", "q2", "q3"]);
  const [mastered, setMastered] = useState<string[]>([]);
  const toggle = (
    id: string,
    update: React.Dispatch<React.SetStateAction<string[]>>,
  ) =>
    update((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  return (
    <Context.Provider
      value={{
        name,
        setName,
        target,
        setTarget,
        completedToday,
        setCompletedToday,
        saved,
        toggleSaved: (id) => toggle(id, setSaved),
        mastered,
        toggleMastered: (id) => toggle(id, setMastered),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDemo() {
  const value = useContext(Context);
  if (!value) throw new Error("DemoProvider is missing");
  return value;
}
