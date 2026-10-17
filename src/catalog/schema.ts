import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(
    'pragma journal_mode = WAL; pragma synchronous = NORMAL; pragma busy_timeout = 5000',
  )
  const version = Number(db.prepare('pragma user_version').get()?.user_version)
  if (version > 2)
    throw new Error('library was created by a newer viquery version')
  if (version === 0) {
    transaction(db, () => {
      db.exec(`
        create table folder (
          id integer primary key, path text not null unique, added_at integer not null
        );
        create table media (
          id integer primary key, sha256 blob not null unique, kind integer not null,
          width integer not null, height integer not null, duration_ms integer,
          has_audio integer not null, taken_at integer not null, added_at integer not null, bytes integer not null,
          codec text, sprite text
        );
        create index media_taken on media(taken_at desc);
        create table file (
          id integer primary key, path text not null unique,
          folder_id integer not null references folder(id) on delete cascade,
          media_id integer references media(id), name text not null,
          size integer not null, mtime_ms integer not null
        );
        create index file_media on file(media_id);
        create index file_folder on file(folder_id);
        create table job (
          media_id integer not null references media(id) on delete cascade,
          stage text not null, generation integer not null, state text not null,
          attempts integer not null default 0, error text,
          primary key (media_id, stage)
        ) without rowid;
        create index job_pending on job(state, stage);
        create table scene (
          id integer primary key, media_id integer not null references media(id) on delete cascade,
          generation integer not null, start_ms integer not null, end_ms integer not null
        );
        create index scene_media on scene(media_id, start_ms);
        create table sample (
          id integer primary key, media_id integer not null references media(id) on delete cascade,
          scene_id integer references scene(id) on delete cascade, generation integer not null,
          t_ms integer, embedding blob not null
        );
        create index sample_media on sample(media_id);
        create table transcript (
          id integer primary key, media_id integer not null references media(id) on delete cascade,
          generation integer not null, start_ms integer not null, end_ms integer not null,
          language text not null, text text not null, embedding blob not null
        );
        create index transcript_media on transcript(media_id, start_ms);
        create virtual table transcript_fts using fts5(
          text, content='transcript', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
        );
        create virtual table file_fts using fts5(
          name, content='file', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
        );
        -- sqlite fts5 external-content triggers: https://sqlite.org/fts5.html#external_content_tables
        create trigger transcript_ai after insert on transcript begin
          insert into transcript_fts(rowid, text) values (new.id, new.text);
        end;
        create trigger transcript_ad after delete on transcript begin
          insert into transcript_fts(transcript_fts, rowid, text) values ('delete', old.id, old.text);
        end;
        create trigger transcript_au after update on transcript begin
          insert into transcript_fts(transcript_fts, rowid, text) values ('delete', old.id, old.text);
          insert into transcript_fts(rowid, text) values (new.id, new.text);
        end;
        create trigger file_ai after insert on file begin
          insert into file_fts(rowid, name) values (new.id, new.name);
        end;
        create trigger file_ad after delete on file begin
          insert into file_fts(file_fts, rowid, name) values ('delete', old.id, old.name);
        end;
        create trigger file_au after update on file begin
          insert into file_fts(file_fts, rowid, name) values ('delete', old.id, old.name);
          insert into file_fts(rowid, name) values (new.id, new.name);
        end;
        pragma user_version = 1;
      `)
    })
  }
  if (version < 2) {
    transaction(db, () => {
      db.exec(`
        create table ocr (
          id integer primary key, media_id integer not null references media(id) on delete cascade,
          generation integer not null, t_ms integer, text text not null, embedding blob not null
        );
        create index ocr_media on ocr(media_id, t_ms);
        create virtual table ocr_fts using fts5(
          text, content='ocr', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
        );
        create trigger ocr_ai after insert on ocr begin
          insert into ocr_fts(rowid, text) values (new.id, new.text);
        end;
        create trigger ocr_ad after delete on ocr begin
          insert into ocr_fts(ocr_fts, rowid, text) values ('delete', old.id, old.text);
        end;
        create trigger ocr_au after update on ocr begin
          insert into ocr_fts(ocr_fts, rowid, text) values ('delete', old.id, old.text);
          insert into ocr_fts(rowid, text) values (new.id, new.text);
        end;
        pragma user_version = 2;
      `)
    })
  }
  return db
}

export function transaction<T>(db: DatabaseSync, write: () => T): T {
  db.exec('begin immediate')
  try {
    const value = write()
    db.exec('commit')
    return value
  } catch (error) {
    db.exec('rollback')
    throw error
  }
}
