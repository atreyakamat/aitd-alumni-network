'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { accountApi, getApiErrorMessage, type DeleteAccountPayload } from '@/lib/api';
import { roleLabel } from '@/lib/roles';
import { saveJson } from '@/lib/download';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DeleteAccountDialog } from '@/components/settings/DeleteAccountDialog';
import { PaymentHistory } from '@/components/settings/PaymentHistory';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';

export default function SettingsPage() {
  const { user, clearSession } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await accountApi.exportMyData();
      const data = res.data.data;
      const date = (data?.exportedAt || new Date().toISOString()).slice(0, 10);
      saveJson(data, `aiem-connection-data-${date}.json`);
      toast({ title: 'Your data is downloading', description: 'A JSON copy of your account data has been saved.' });
    } catch (err) {
      toast({
        title: 'Could not export your data',
        description: getApiErrorMessage(err, 'Please try again in a moment.'),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (payload: DeleteAccountPayload) => {
    // Errors propagate to the dialog, which shows the server message inline.
    await accountApi.deleteMyAccount(payload);
    setDeleteOpen(false);
    clearSession();
    queryClient.clear();
    toast({ title: 'Account deleted', description: 'Your account has been removed. We are sorry to see you go.' });
    router.replace('/login');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account settings</h1>
        <p className="text-muted-foreground">Manage your password, data, payments and account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserCog className="h-5 w-5 text-primary" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Name</p>
            <p className="font-medium">{user?.fullName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Email</p>
            <p className="font-medium break-all">{user?.email}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Role</p>
            <Badge variant="secondary">{roleLabel(user?.role)}</Badge>
          </div>
          <div>
            <p className="text-muted-foreground">Verification</p>
            <p className="font-medium flex items-center gap-1">
              {user?.isVerified ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-green-600" /> Verified
                </>
              ) : (
                'Not verified'
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <ChangePasswordCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Download my data
          </CardTitle>
          <CardDescription>
            Get a copy of your profile, posts, connections, messages and payment records as a JSON file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {exporting ? 'Preparing export...' : 'Download my data'}
          </Button>
        </CardContent>
      </Card>

      <PaymentHistory />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete my account
          </CardTitle>
          <CardDescription>
            Permanently delete your account and personal data. Consider downloading your data first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete my account
          </Button>
        </CardContent>
      </Card>

      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleDelete} />
    </div>
  );
}
