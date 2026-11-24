/**
 * SYNTHETIC DEMONSTRATION SCENARIO — none of these incidents happened.
 * Every row created from this file is stored with is_synthetic = true and is
 * labelled "Synthetic" throughout the UI, API and PDF exports.
 *
 * Times are relative to the moment the seed runs (minutes ago).
 */
import type { Category } from "@/lib/domain/constants";

export interface SeedReport {
  key: string;
  title: string;
  description: string;
  category: Category;
  locationText: string;
  latitude: number | null;
  longitude: number | null;
  minutesAgo: number;
  anonymous: boolean;
  submitter: string; // synthetic submitter key; equal keys = same source
}

export const SCENARIO_NAME = "Ibadan flash-flood scenario (synthetic)";

export const SEED_REPORTS: SeedReport[] = [
  // --- The core scenario: five independent reports of one developing flood ---
  {
    key: "flood-1",
    title: "Flooding near Bodija market",
    description:
      "Water has covered the road beside Bodija market after heavy rain since early morning. It is above knee level at the junction and is entering some shops. Traders are moving goods to higher ground.",
    category: "flooding",
    locationText: "Bodija Market, Ibadan",
    latitude: 7.4352,
    longitude: 3.9133,
    minutesAgo: 190,
    anonymous: false,
    submitter: "synthetic-a",
  },
  {
    key: "flood-2",
    title: "Water levels rising quickly in Agbowo",
    description:
      "The stream behind Agbowo shopping complex has overflowed. Water levels are rising fast and houses on the low side of the street are flooding. Some residents are asking for help to move elderly neighbours.",
    category: "flooding",
    locationText: "Agbowo, Ibadan",
    latitude: 7.4447,
    longitude: 3.9058,
    minutesAgo: 165,
    anonymous: true,
    submitter: "synthetic-b",
  },
  {
    key: "flood-3",
    title: "Road access blocked by flood water on UI road",
    description:
      "The road towards the University of Ibadan second gate is blocked by flood water. Cars are turning back and one small car is stuck in the water. No way through for vehicles at the moment.",
    category: "road_accident",
    locationText: "UI Second Gate road, Ibadan",
    latitude: 7.4498,
    longitude: 3.8976,
    minutesAgo: 140,
    anonymous: false,
    submitter: "synthetic-c",
  },
  {
    key: "flood-4",
    title: "Heavy rainfall and water accumulating in streets",
    description:
      "Heavy rainfall for over four hours. Water is accumulating in the streets of Sango and drainage channels are full and overflowing. Flooding is getting worse near the main road.",
    category: "natural_disaster",
    locationText: "Sango, Ibadan",
    latitude: 7.4268,
    longitude: 3.8915,
    minutesAgo: 120,
    anonymous: true,
    submitter: "synthetic-d",
  },
  {
    key: "flood-5",
    title: "Residential homes flooded in Mokola",
    description:
      "Several homes in Mokola are flooded, water is inside living rooms. Families are moving belongings upstairs and some children were carried out by neighbours. Water still rising slowly.",
    category: "flooding",
    locationText: "Mokola, Ibadan",
    latitude: 7.4069,
    longitude: 3.8939,
    minutesAgo: 95,
    anonymous: false,
    submitter: "synthetic-e",
  },
  // Same source re-submitting: must be flagged as a possible duplicate, not corroboration.
  {
    key: "flood-dup",
    title: "Bodija market flooding - update",
    description:
      "Update: water covering the road beside Bodija market is still above knee level at the junction and entering shops. Traders moving goods.",
    category: "flooding",
    locationText: "Bodija Market, Ibadan",
    latitude: 7.4355,
    longitude: 3.9129,
    minutesAgo: 70,
    anonymous: false,
    submitter: "synthetic-a",
  },
  // Same category but far away: must NOT join the Ibadan cluster.
  {
    key: "flood-far",
    title: "Minor flooding on Abeokuta road",
    description: "Some water on the road near the Abeokuta roundabout after the rain. Cars are passing slowly. Not serious for now.",
    category: "flooding",
    locationText: "Abeokuta, Ogun",
    latitude: 7.1475,
    longitude: 3.3619,
    minutesAgo: 150,
    anonymous: true,
    submitter: "synthetic-f",
  },
  // --- Other synthetic incidents for geographic diversity ---
  {
    key: "fire-1",
    title: "Fire at a warehouse in Oregun industrial area",
    description: "Thick black smoke and flames from a warehouse roof in Oregun. Fire service vehicles have not arrived yet. People are watching from across the road.",
    category: "fire",
    locationText: "Oregun, Ikeja, Lagos",
    latitude: 6.6059,
    longitude: 3.3634,
    minutesAgo: 300,
    anonymous: false,
    submitter: "synthetic-g",
  },
  {
    key: "fire-2",
    title: "Smoke visible over Oregun from Kudirat Abiola Way",
    description: "Big column of black smoke visible over Oregun from Kudirat Abiola Way. Smells like burning plastic. Traffic is slowing down to look.",
    category: "fire",
    locationText: "Kudirat Abiola Way, Ikeja, Lagos",
    latitude: 6.6091,
    longitude: 3.3581,
    minutesAgo: 285,
    anonymous: true,
    submitter: "synthetic-h",
  },
  {
    key: "accident-1",
    title: "Collision involving a minibus on Thika Road",
    description: "A minibus and a lorry collided on Thika Road near Roysambu. At least two people appear injured and are sitting by the roadside. Traffic is backed up heavily.",
    category: "road_accident",
    locationText: "Thika Road, Roysambu, Nairobi",
    latitude: -1.2186,
    longitude: 36.8868,
    minutesAgo: 420,
    anonymous: false,
    submitter: "synthetic-i",
  },
  {
    key: "infra-1",
    title: "Partial collapse of pedestrian bridge",
    description: "Part of the pedestrian footbridge near the Kaneshie market has collapsed onto the road below. No one seems trapped but the road is partly blocked with concrete.",
    category: "infrastructure_failure",
    locationText: "Kaneshie, Accra",
    latitude: 5.5652,
    longitude: -0.2368,
    minutesAgo: 600,
    anonymous: true,
    submitter: "synthetic-j",
  },
  {
    key: "security-1",
    title: "Gunshots heard near a market junction",
    description: "Several gunshots heard near the market junction around dusk. People running away and shops closing quickly. I did not see who was shooting.",
    category: "violence_security",
    locationText: "Market junction (location withheld)",
    latitude: 9.0643,
    longitude: 7.4892,
    minutesAgo: 240,
    anonymous: true,
    submitter: "synthetic-k",
  },
  {
    key: "env-1",
    title: "Oil sheen on river near fishing settlement",
    description: "Dark oily film on the river surface near the fishing jetty, with a strong fuel smell. Fishermen say dead fish washed up this morning.",
    category: "environmental",
    locationText: "Bodo creek area, Rivers State",
    latitude: 4.6075,
    longitude: 7.2638,
    minutesAgo: 900,
    anonymous: true,
    submitter: "synthetic-l",
  },
];
