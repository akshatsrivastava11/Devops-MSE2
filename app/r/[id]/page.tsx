import type { Metadata } from "next";
import { Room } from "@/components/Room";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id.toLowerCase()} on Burnroom` };
}

export default async function RoomPage({ params }: Props) {
  const { id } = await params;
  return <Room roomId={id.toLowerCase()} />;
}
