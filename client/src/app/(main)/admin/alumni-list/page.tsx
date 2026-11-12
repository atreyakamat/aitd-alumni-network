'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { adminApi, getApiErrorCode, getApiErrorMessage, type AlumniRecord } from '@/lib/api';
import {
  IMPORT_CHUNK_SIZE,
  MAX_IMPORT_FILE_BYTES,
  chunkRows,
  parseAlumniCsv,
  type AlumniCsvResult,
  type ParsedAlumniRow,
} from '@/lib/alumni-csv';
import { formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pagination } from '@/components/shared/Pagination';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminErrorState } from '@/components/admin/AdminErrorState';

const PAGE_SIZE = 25;
const PREVIEW_ROWS = 10;
const SHOWN_PROBLEMS = 20;
const HEADER_EXAMPLE = 'fullName,batchYear,department,enrollmentNumber';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** What an import of several chunks added up to. Row numbers are mapped back to the lines of the file. */
interface ImportReport {
  sent: number;
  created: number;
  updated: number;
  skipped: number;
  /** Rows that were left out before sending, because the file itself had a problem with them. */
  leftOut: number;
  problems: Array<{ line: number; message: string }>;
}

const readFileText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsText(file);
  });

function ProblemList({ problems, total }: { problems: Array<{ line: number; message: string }>; total: number }) {
  if (problems.length === 0) return null;
  const shown = problems.slice(0, SHOWN_PROBLEMS);
  return (
    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
      {shown.map((p, i) => (
        <li key={`${p.line}-${i}`}>
          Line {p.line}: {p.message}
        </li>
      ))}
      {total > shown.length && <li className="list-none text-muted-foreground">...and {total - shown.length} more.</li>}
    </ul>
  );
}

/** Choose or paste the CSV, see what will happen, then send it in chunks. The file is parsed here: nothing is uploaded as a file. */
function ImportCard({ onImported }: { onImported: () => void }) {
  const [text, setText] = React.useState('');
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [parsed, setParsed] = React.useState<AlumniCsvResult | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const running = progress !== null;

  const check = (source: string) => {
    setReport(null);
    setImportError(null);
    setParsed(parseAlumniCsv(source));
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setFileError(`That file is too big (more than ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB). Split it into smaller files.`);
      setParsed(null);
      return;
    }
    try {
      const content = await readFileText(file);
      setText(content);
      check(content);
    } catch {
      setFileError('The file could not be read. Try another file, or paste its content below.');
      setParsed(null);
    }
  };

  const send = async () => {
    if (!parsed || parsed.rows.length === 0 || running) return;
    const chunks = chunkRows<ParsedAlumniRow>(parsed.rows);
    const total = parsed.rows.length;
    const totals: ImportReport = { sent: 0, created: 0, updated: 0, skipped: 0, leftOut: parsed.errors.length, problems: [] };
    setImportError(null);
    setReport(null);
    setProgress({ done: 0, total });
    try {
      for (const chunk of chunks) {
        const answer = (await adminApi.importAlumniRecords(chunk.map(({ fullName, batchYear, department, enrollmentNumber }) => ({ fullName, batchYear, department, enrollmentNumber })))).data.data;
        totals.sent += chunk.length;
        totals.created += answer.created;
        totals.updated += answer.updated;
        totals.skipped += answer.skipped;
        for (const problem of answer.errors) {
          totals.problems.push({ line: chunk[problem.row - 1]?.line ?? problem.row, message: problem.message });
        }
        setProgress({ done: totals.sent, total });
      }
      setReport(totals);
      setText('');
      setParsed(null);
      if (fileInput.current) fileInput.current.value = '';
      onImported();
    } catch (err) {
      setImportError(
        `The import stopped after ${plural(totals.sent, 'row', 'rows')} of ${total.toLocaleString('en-IN')}: ${getApiErrorMessage(err, 'Please try again.')} ` +
          'The rows already sent are saved. Importing the file again is safe: it updates records, it never duplicates them.'
      );
      if (totals.sent > 0) onImported();
    } finally {
      setProgress(null);
    }
  };

  const ready = parsed?.rows ?? [];
  const problems = parsed?.errors ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Upload className="h-5 w-5" aria-hidden="true" /> Import the list
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          One person per line, with the header row <code className="rounded bg-muted px-1 py-0.5">{HEADER_EXAMPLE}</code>. Only{' '}
          <code className="rounded bg-muted px-1 py-0.5">fullName</code> and <code className="rounded bg-muted px-1 py-0.5">batchYear</code> are
          required. A row whose enrolment number is already on the list updates that record. The file is read in your browser and sent in
          pieces of {IMPORT_CHUNK_SIZE}.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="alumni-csv-file">Choose a CSV file</Label>
          <Input
            id="alumni-csv-file"
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
            disabled={running}
          />
          {fileError && (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="alumni-csv-text">Or paste the CSV here</Label>
          <Textarea
            id="alumni-csv-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setParsed(null);
              setReport(null);
            }}
            rows={6}
            placeholder={`${HEADER_EXAMPLE}\nAda Alum,2015,Computer Engineering,12CE045`}
            className="font-mono text-xs"
            disabled={running}
            spellCheck={false}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => check(text)} disabled={running || text.trim() === ''}>
            Check the file
          </Button>
        </div>

        {parsed?.fatal && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {parsed.fatal}
          </p>
        )}

        {parsed && !parsed.fatal && (
          <section aria-label="Preview of the import" className="space-y-3 rounded-md border p-4">
            <p role="status" className="text-sm font-medium">
              {plural(ready.length, 'row is', 'rows are')} ready to import
              {problems.length > 0 && `. ${plural(problems.length, 'row has a problem and', 'rows have problems and')} will be left out`}.
            </p>
            {problems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-destructive">Problems in the file</h3>
                <ProblemList problems={problems} total={problems.length} />
              </div>
            )}
            {ready.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="mb-1 text-left text-xs text-muted-foreground">
                    {ready.length > PREVIEW_ROWS ? `The first ${PREVIEW_ROWS} of ${ready.length.toLocaleString('en-IN')} rows` : 'The rows to be imported'}
                  </caption>
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-1 pr-3 font-medium">Line</th>
                      <th scope="col" className="py-1 pr-3 font-medium">Name</th>
                      <th scope="col" className="py-1 pr-3 font-medium">Batch</th>
                      <th scope="col" className="py-1 pr-3 font-medium">Department</th>
                      <th scope="col" className="py-1 font-medium">Enrolment number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ready.slice(0, PREVIEW_ROWS).map((row) => (
                      <tr key={row.line} className="border-b last:border-0">
                        <td className="py-1 pr-3 text-muted-foreground">{row.line}</td>
                        <td className="py-1 pr-3 break-words">{row.fullName}</td>
                        <td className="py-1 pr-3">{row.batchYear}</td>
                        <td className="py-1 pr-3 break-words">{row.department ?? ''}</td>
                        <td className="py-1 break-all">{row.enrollmentNumber ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button type="button" onClick={() => void send()} disabled={running || ready.length === 0}>
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {running ? 'Importing...' : `Import ${plural(ready.length, 'row', 'rows')}`}
            </Button>
          </section>
        )}

        {progress && (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            Imported {progress.done.toLocaleString('en-IN')} of {progress.total.toLocaleString('en-IN')} rows...
          </p>
        )}

        {importError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {importError}
          </p>
        )}

        {report && (
          <section aria-label="Result of the import" className="rounded-md border border-green-600/30 bg-green-50 p-4 text-sm dark:bg-green-950/20">
            <p role="status" className="font-medium">
              Import finished: {report.created.toLocaleString('en-IN')} added, {report.updated.toLocaleString('en-IN')} updated,{' '}
              {(report.skipped + report.leftOut).toLocaleString('en-IN')} left out.
            </p>
            {report.leftOut > 0 && <p className="mt-1 text-muted-foreground">{plural(report.leftOut, 'row', 'rows')} had a problem in the file and was not sent.</p>}
            {report.skipped > 0 && (
              <p className="mt-1 text-muted-foreground">
                {plural(report.skipped, 'row', 'rows')} changed nothing: already on the list exactly like that, repeated, or not accepted (see below).
              </p>
            )}
            <ProblemList problems={report.problems} total={report.problems.length} />
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function AlumniListContent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [removing, setRemoving] = React.useState<AlumniRecord | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = { search: search || undefined, page, limit: PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: ['admin', 'alumni-records', filters],
    queryFn: async () => (await adminApi.listAlumniRecords(filters)).data,
    placeholderData: keepPreviousData,
  });

  // Matches on the approvals page change with the list
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'alumni-records'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'approvals'] });
  };

  const removeMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteAlumniRecord(id),
    onSuccess: () => {
      toast({ title: 'Record removed', description: `${removing?.fullName ?? 'The record'} is no longer on the college list.` });
      setRemoving(null);
      refresh();
    },
    onError: (err) => {
      if (getApiErrorCode(err) === 'NOT_FOUND') {
        // somebody else removed it first: the list on screen is stale
        setRemoving(null);
        refresh();
        toast({ title: 'Already removed', description: 'This record was removed a moment ago.' });
        return;
      }
      const message = getApiErrorMessage(err, 'Could not remove this record. Please try again.');
      setRemoveError(message);
      toast({ variant: 'destructive', title: 'Could not remove', description: message });
    },
  });

  const rows = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination;
  const total = pagination?.total;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="College alumni list"
        icon={ListChecks}
        badge={
          typeof total === 'number' && !search ? (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold" aria-label={`${total} records on the list`}>
              {total.toLocaleString('en-IN')} {total === 1 ? 'record' : 'records'}
            </span>
          ) : undefined
        }
        description="The people the college knows as alumni. Every registration is checked against this list, so you can see at a glance who is on it."
      />

      <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        This list is personal data of people who may not have registered. Only administrators can see it, every import and removal is
        recorded in the audit log, and it should be deleted when it is no longer needed.
      </p>

      <ImportCard onImported={refresh} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Records</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form role="search" aria-label="Search the college list" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}>
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Search the college list"
                placeholder="Search by name, batch, department or enrolment number"
                className="pl-9"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </form>

          {listQuery.isError ? (
            <AdminErrorState
              title="Could not load the college list"
              message={getApiErrorMessage(listQuery.error, 'Please try again.')}
              onRetry={() => void listQuery.refetch()}
              retrying={listQuery.isFetching}
            />
          ) : listQuery.isLoading ? (
            <div className="space-y-2" aria-label="Loading the college list">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center">
              <ListChecks className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h3 className="font-semibold">{search ? 'No records match this search' : 'The college list is empty'}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {search ? 'Try a different name, batch or enrolment number.' : 'Import the list above, and every registration will be checked against it.'}
              </p>
            </div>
          ) : (
            <div className={listQuery.isFetching ? 'overflow-x-auto opacity-60 transition-opacity' : 'overflow-x-auto'}>
              <table className="w-full text-sm">
                <caption className="sr-only">People on the college alumni list</caption>
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Batch</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Department</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Enrolment number</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Added</th>
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((record) => (
                    <tr key={record.id} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium break-words">
                        {record.fullName}
                      </th>
                      <td className="py-2 pr-3">{record.batchYear}</td>
                      <td className="py-2 pr-3 break-words">{record.department ?? <span className="text-muted-foreground">Not given</span>}</td>
                      <td className="py-2 pr-3 break-all">{record.enrollmentNumber ?? <span className="text-muted-foreground">Not given</span>}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{formatDate(record.createdAt)}</td>
                      <td className="py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${record.fullName} from the list`}
                          onClick={() => {
                            setRemoveError(null);
                            setRemoving(record);
                          }}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!listQuery.isError && rows.length > 0 && (
            <Pagination pagination={pagination} onPageChange={setPage} disabled={listQuery.isFetching} noun="records" />
          )}
        </CardContent>
      </Card>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && !removeMutation.isPending && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Remove ${removing?.fullName ?? 'this record'} from the list?`}</DialogTitle>
            <DialogDescription>
              Nobody is deleted from the platform: a registration of this person is simply no longer matched against this record. The removal
              is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {removeError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)} disabled={removeMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => removing && removeMutation.mutate(removing.id)}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {removeMutation.isPending ? 'Removing...' : 'Remove record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The college alumni list. Access is gated by admin/layout.tsx (ADMIN+). */
export default function AdminAlumniListPage() {
  return <AlumniListContent />;
}
