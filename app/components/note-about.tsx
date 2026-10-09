"use client";

// [Guru]
import { NoteFacts } from "@/components/note-facts";
import { NoteLinks } from "@/components/note-links";
import { WhatNext } from "@/components/what-next";

/**
 * What the app worked out about one note, beside it: the notes it connects
 * to, the details it states, and what next. The note screen and the
 * plugins' "This note" tab are both this.
 */
export function NoteAbout({ id, declined = false }: { id: string; declined?: boolean }) {
  return (
    <>
      <NoteLinks recordingId={id} />
      <NoteFacts recordingId={id} />
      {!declined && <WhatNext scope="item" target={id} />}
    </>
  );
}
