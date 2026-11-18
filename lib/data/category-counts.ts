import mongoose, { Types } from "mongoose";
import Contact from "@/lib/models/contact";

export async function getCategoryContactCounts(categoryIds: Types.ObjectId[]) {
  const counts = new Map<string, number>();
  for (const id of categoryIds) counts.set(id.toString(), 0);

  if (categoryIds.length === 0 || !mongoose.connection.db) return counts;

  const contactsCollectionExists = await mongoose.connection.db
    .listCollections({ name: "contacts" }, { nameOnly: true })
    .hasNext();

  if (!contactsCollectionExists) return counts;

  const totals = await Contact.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { categoryId: { $in: categoryIds } } },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } }
  ]);

  for (const total of totals) counts.set(total._id.toString(), total.count);
  return counts;
}
