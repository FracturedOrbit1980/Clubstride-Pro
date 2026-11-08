import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { supabase } from '../../../core/supabaseClient';
import { formatDay } from '../attendance/week';
import { previewPrivateNote, savePreviewPrivateNote } from '../../shared/demo';
import { ci } from '../../shared/ci';
import {
  PRIVATE_NOTE_MAX,
  clampPrivateNote,
  isMissingPrivateNotesTable,
  parsePrivateNoteRow,
  privateNotePayload,
  type PrivateNote,
} from '../player/privateNotes';

type Access = 'club' | 'preview' | 'device';
type Phase = 'loading' | 'ready' | 'failed';

const MISSING_TABLE =
  'This club has no private note field on the server yet, so nothing has been saved. '
  + 'supabase/migrations/20261108120000_private_coach_notes.sql has to be applied to the project first.';

const emptyNote = (playerId: string): PrivateNote => ({ playerId, note: '', updatedAt: null });

/**
 * The note that stops being a family update.
 *
 * Only coaches and managers on this squad read it: the table has no guardian policy, the share
 * code's lookup never queries it, and the report PDF is built from the assessment row. It is also
 * never queued or cached - a note that stays on the club server is the whole point, so a phone
 * with no signal cannot write one, and the card says that rather than keeping the text somewhere
 * it claimed not to. If the table is not exposed yet, the card names the migration instead of
 * pretending.
 */
export const PrivateNoteCard: React.FC<{
  playerId: string;
  teamId: string | null;
  /** 'club' reads the server, 'preview' keeps the visit, 'device' has no server to write to. */
  access: Access;
}> = ({ playerId, teamId, access }) => {
  const [note, setNote] = useState<PrivateNote>(emptyNote(playerId));
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>(access === 'club' ? 'loading' : 'ready');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);
  const scopeRef = useRef('');
  const loadRequest = useRef(0);

  const load = useCallback((): void => {
    const request = ++loadRequest.current;
    const active = (): boolean => request === loadRequest.current;
    setError(null);
    setNotice(null);

    if (access === 'preview') {
      const current = previewPrivateNote(playerId);
      setNote({ playerId, note: current, updatedAt: null });
      if (!edited.current) setText(current);
      setPhase('ready');
      return;
    }
    if (access !== 'club' || teamId === null) {
      setNote(emptyNote(playerId));
      setPhase('ready');
      return;
    }

    setPhase('loading');
    void (async () => {
      try {
        const { data, error: readError } = await supabase
          .from('player_private_notes')
          .select('player_id, note, updated_at')
          .eq('player_id', playerId)
          .maybeSingle();
        if (!active()) return;
        if (readError) {
          setError(isMissingPrivateNotesTable({ code: readError.code, message: readError.message })
            ? MISSING_TABLE
            : `The private note could not be read: ${readError.message}`);
          setPhase('failed');
          return;
        }
        // No row is not an error: nobody has written about this child yet.
        const incoming = parsePrivateNoteRow(data);
        setNote(incoming ?? emptyNote(playerId));
        if (!edited.current) setText(incoming?.note ?? '');
        setPhase('ready');
      } catch (cause: unknown) {
        if (!active()) return;
        setError(`The private note could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
        setPhase('failed');
      }
    })();
  }, [access, playerId, teamId]);

  useEffect(() => {
    const scope = `${access}|${playerId}|${teamId ?? ''}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      edited.current = false;
      setText('');
      setNote(emptyNote(playerId));
    }
    void load();
    return () => { loadRequest.current += 1; };
  }, [load, playerId, teamId, access]);

  const dirty = clampPrivateNote(text) !== note.note;

  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const next = clampPrivateNote(text);

    if (access === 'preview') {
      savePreviewPrivateNote(playerId, next);
      loadRequest.current += 1;
      setNote({ playerId, note: next, updatedAt: null });
      edited.current = false;
      setText(next);
      setPhase('ready');
      setNotice('Saved for this preview. It goes when the app closes.');
      setBusy(false);
      return;
    }
    if (access !== 'club' || teamId === null) {
      setBusy(false);
      setError('A private note belongs to a squad on the club server, and this account is not writing to one.');
      return;
    }

    try {
      const { data, error: writeError } = await supabase
        .from('player_private_notes')
        // One live row per child: creating, editing and clearing are the same upsert, and the
        // database stamps updated_at and who wrote it.
        .upsert(privateNotePayload(playerId, teamId, text), { onConflict: 'player_id' })
        .select('player_id, note, updated_at')
        .maybeSingle();
      if (writeError) {
        setError(isMissingPrivateNotesTable({ code: writeError.code, message: writeError.message })
          ? MISSING_TABLE
          : `The note was not saved: ${writeError.message}`);
        setBusy(false);
        return;
      }
      const saved = parsePrivateNoteRow(data) ?? { playerId, note: next, updatedAt: null };
      setNote(saved);
      edited.current = false;
      setText(saved.note);
      setPhase('ready');
      setNotice('Saved on the club server. Only the coaches and managers on this squad can read it.');
    } catch (cause: unknown) {
      setError(`The note was not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  if (access === 'device') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Private coaching note</Text>
        <Text style={styles.hint}>
          A private note needs a squad on the club server. A device team keeps everything in this phone's
          storage, where anyone holding the phone can read it, so there is no private field here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Private coaching note</Text>
      <Text style={styles.hint}>
        Only the coaches and managers on this squad read this. It is not on the family's page, the share link
        or the report PDF.
      </Text>

      {phase === 'failed' ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <Pressable
            onPress={() => void load()}
            accessibilityRole="button"
            accessibilityLabel="Try reading the private note again"
            style={styles.retry}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            value={text}
            onChangeText={value => {
              edited.current = true;
              setText(value);
              setNotice(null);
            }}
            placeholder="What the coaching staff is working on, and with whom."
            placeholderTextColor={ci.color.muted}
            accessibilityLabel="Private coaching note"
            multiline
            maxLength={PRIVATE_NOTE_MAX}
            style={styles.input}
          />
          <Text style={styles.hint}>
            {dirty
              ? 'Unsaved changes.'
              : note.updatedAt
                ? `Saved ${formatDay(note.updatedAt.slice(0, 10))}.`
                : note.note
                  ? 'Saved.'
                  : 'Nothing written yet.'}{' '}
            {access === 'preview'
              ? 'Kept for this visit only.'
              : 'Goes to the club server when you save, so it needs a connection. It is not kept on this phone.'}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {phase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}
          <Pressable
            onPress={() => void save()}
            disabled={!dirty || busy}
            accessibilityRole="button"
            accessibilityLabel={busy ? 'Saving the private note' : 'Save the private note'}
            aria-disabled={!dirty || busy}
            aria-busy={busy}
            style={[styles.primary, (!dirty || busy) && styles.primaryOff]}
          >
            <Text style={styles.primaryLabel}>{busy ? 'Saving...' : dirty ? 'Save private note' : 'All saved'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
};

const styles = {
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  hint: { color: ci.color.muted, fontSize: 12, lineHeight: 17 },
  input: {
    minHeight: 88,
    padding: 10,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.borderInput,
    color: ci.color.text,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  // The brief asks for 44 x 44 touch targets, and padding alone lands one pixel short here.
  primary: { minHeight: 44, paddingVertical: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.accent, alignItems: 'center', justifyContent: 'center' },
  primaryOff: { opacity: 0.5 },
  primaryLabel: { color: ci.color.onAccent, fontSize: 14, fontWeight: '800' },
  retry: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: ci.radius.chip,
    backgroundColor: ci.color.raised,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  notice: { color: ci.color.go, fontSize: 13, lineHeight: 19 },
} as const;
