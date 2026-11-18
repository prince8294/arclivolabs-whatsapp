import {
  Building2,
  CarFront,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Hotel,
  House,
  Shirt,
  ShoppingBag,
  Utensils,
  type LucideIcon
} from "lucide-react";

export const categoryIcons = {
  building: Building2,
  car: CarFront,
  fitness: Dumbbell,
  education: GraduationCap,
  healthcare: HeartPulse,
  hotel: Hotel,
  realEstate: House,
  fashion: Shirt,
  shopping: ShoppingBag,
  restaurant: Utensils
} satisfies Record<string, LucideIcon>;

export type CategoryIconName = keyof typeof categoryIcons;

export const categoryIconOptions: { name: CategoryIconName; label: string }[] = [
  { name: "building", label: "Business" },
  { name: "education", label: "Education" },
  { name: "restaurant", label: "Restaurant" },
  { name: "hotel", label: "Hotel" },
  { name: "realEstate", label: "Real estate" },
  { name: "healthcare", label: "Healthcare" },
  { name: "fitness", label: "Fitness" },
  { name: "fashion", label: "Fashion" },
  { name: "car", label: "Automobile" },
  { name: "shopping", label: "Shopping" }
];

export function isCategoryIconName(value: unknown): value is CategoryIconName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(categoryIcons, value);
}
