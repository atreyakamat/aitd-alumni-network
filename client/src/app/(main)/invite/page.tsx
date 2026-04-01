'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Mail,
  Upload,
  Users,
  Send,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Copy,
  ExternalLink,
  Download,
  X,
  Plus,
  Trash2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';

interface InviteEntry {
  email: string;
  name: string;
  batchYear?: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  error?: string;
}

const INVITE_TEMPLATE = `Hi {{name}},

I hope this message finds you well! I wanted to reach out and invite you to join our AITD Connection platform - a dedicated space for our AITD alumni community.

As a fellow graduate from the Class of {{batchYear}}, I thought you'd be interested in reconnecting with classmates, exploring career opportunities, and staying updated on events and news from our alma mater.

Here's what you can do on AITD Connection:
• Find and reconnect with batchmates and other alumni
• Access exclusive job postings and mentorship opportunities
• Stay updated on events, reunions, and news
• Contribute to the community through donations and volunteering

Join us today: {{inviteLink}}

Looking forward to seeing you on the platform!

Best regards,
{{senderName}}
AITD Alumni Network`;

export default function InviteBatchmatesPage() {
  const [activeTab, setActiveTab] = useState('manual');
  const [manualEmails, setManualEmails] = useState<InviteEntry[]>([
    { email: '', name: '', batchYear: '', status: 'pending' },
  ]);
  const [csvData, setCsvData] = useState<InviteEntry[]>([]);
  const [messageTemplate, setMessageTemplate] = useState(INVITE_TEMPLATE);
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [inviteLink, setInviteLink] = useState('');

  const addManualEntry = () => {
    setManualEmails([
      ...manualEmails,
      { email: '', name: '', batchYear: '', status: 'pending' },
    ]);
  };

  const removeManualEntry = (index: number) => {
    setManualEmails(manualEmails.filter((_, i) => i !== index));
  };

  const updateManualEntry = (index: number, field: keyof InviteEntry, value: string) => {
    const updated = [...manualEmails];
    (updated[index] as any)[field] = value;
    setManualEmails(updated);
  };

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split('\n').filter((line) => line.trim());
    
    // Skip header row
    const dataLines = lines.slice(1);
    
    const entries: InviteEntry[] = dataLines.map((line) => {
      const [email, name, batchYear] = line.split(',').map((s) => s.trim());
      return {
        email: email || '',
        name: name || '',
        batchYear: batchYear || '',
        status: 'pending' as const,
      };
    }).filter((entry) => entry.email);

    setCsvData(entries);
  };

  const downloadCSVTemplate = () => {
    const template = 'email,name,batch_year\njohn.doe@example.com,John Doe,2020\njane.smith@example.com,Jane Smith,2019';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invite_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateInviteLink = async () => {
    try {
      const response = await api.post('/api/invites/generate-link');
      setInviteLink(response.data?.data?.link || `${window.location.origin}/register?ref=invite`);
    } catch (error) {
      // Fallback link
      setInviteLink(`${window.location.origin}/register?ref=invite`);
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
  };

  const sendInvitations = async (entries: InviteEntry[]) => {
    setIsSending(true);
    setSendProgress(0);

    const validEntries = entries.filter((e) => e.email && e.name);
    let completed = 0;

    for (const entry of validEntries) {
      try {
        entry.status = 'sending';
        
        await api.post('/api/invites/send', {
          email: entry.email,
          name: entry.name,
          batchYear: entry.batchYear,
          message: messageTemplate,
        });
        
        entry.status = 'sent';
      } catch (error: any) {
        entry.status = 'failed';
        entry.error = error.response?.data?.message || 'Failed to send';
      }

      completed++;
      setSendProgress((completed / validEntries.length) * 100);
      
      // Force re-render
      if (activeTab === 'manual') {
        setManualEmails([...manualEmails]);
      } else {
        setCsvData([...csvData]);
      }
    }

    setIsSending(false);
  };

  const getStatusIcon = (status: InviteEntry['status']) => {
    switch (status) {
      case 'sent':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'sending':
        return <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="container mx-auto px-6 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-headline text-3xl font-bold text-gray-900 mb-2">
            Invite Batchmates
          </h1>
          <p className="text-gray-500">
            Help grow our alumni community by inviting your classmates to join
          </p>
        </div>

        {/* Quick Invite Link */}
        <Card className="bg-gradient-to-br from-[#002045] to-[#004488] text-white mb-8 border-0">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Share Your Invite Link</h3>
                <p className="text-blue-200 text-sm">
                  Share this link on social media or messaging apps to invite alumni
                </p>
              </div>
              <div className="flex gap-2">
                {inviteLink ? (
                  <>
                    <Input
                      value={inviteLink}
                      readOnly
                      className="w-64 bg-white/10 border-white/20 text-white"
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={copyInviteLink}
                      className="bg-white/20 hover:bg-white/30"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <Button onClick={generateInviteLink} variant="secondary">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Generate Link
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-white border mb-6">
                <TabsTrigger value="manual" className="data-[state=active]:bg-[#002045] data-[state=active]:text-white">
                  <Mail className="h-4 w-4 mr-2" />
                  Manual Entry
                </TabsTrigger>
                <TabsTrigger value="csv" className="data-[state=active]:bg-[#002045] data-[state=active]:text-white">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  CSV Upload
                </TabsTrigger>
              </TabsList>

              {/* Manual Entry Tab */}
              <TabsContent value="manual">
                <Card className="border-0 shadow-md">
                  <CardHeader>
                    <CardTitle>Add Contacts Manually</CardTitle>
                    <CardDescription>
                      Enter email addresses of alumni you'd like to invite
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {manualEmails.map((entry, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex gap-3 items-start"
                      >
                        <div className="flex-1 grid sm:grid-cols-3 gap-3">
                          <Input
                            placeholder="Email address"
                            type="email"
                            value={entry.email}
                            onChange={(e) => updateManualEntry(index, 'email', e.target.value)}
                            disabled={entry.status !== 'pending'}
                          />
                          <Input
                            placeholder="Full name"
                            value={entry.name}
                            onChange={(e) => updateManualEntry(index, 'name', e.target.value)}
                            disabled={entry.status !== 'pending'}
                          />
                          <Input
                            placeholder="Batch year"
                            value={entry.batchYear}
                            onChange={(e) => updateManualEntry(index, 'batchYear', e.target.value)}
                            disabled={entry.status !== 'pending'}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(entry.status)}
                          {manualEmails.length > 1 && entry.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeManualEntry(index)}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    ))}

                    <Button
                      variant="outline"
                      onClick={addManualEntry}
                      className="w-full"
                      disabled={isSending}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Another
                    </Button>

                    {isSending && (
                      <div className="space-y-2">
                        <Progress value={sendProgress} />
                        <p className="text-sm text-gray-500 text-center">
                          Sending invitations... {Math.round(sendProgress)}%
                        </p>
                      </div>
                    )}

                    <Button
                      onClick={() => sendInvitations(manualEmails)}
                      disabled={isSending || !manualEmails.some((e) => e.email && e.name)}
                      className="w-full bg-[#002045] hover:bg-[#003366]"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send Invitations
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* CSV Upload Tab */}
              <TabsContent value="csv">
                <Card className="border-0 shadow-md">
                  <CardHeader>
                    <CardTitle>Bulk Upload via CSV</CardTitle>
                    <CardDescription>
                      Upload a CSV file with email, name, and batch year columns
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {csvData.length === 0 ? (
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
                        <Upload className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                          Upload CSV File
                        </h3>
                        <p className="text-gray-500 mb-4">
                          File should contain columns: email, name, batch_year
                        </p>
                        <div className="flex gap-3 justify-center">
                          <label>
                            <input
                              type="file"
                              accept=".csv"
                              onChange={handleCSVUpload}
                              className="hidden"
                            />
                            <Button variant="default" asChild>
                              <span>
                                <Upload className="h-4 w-4 mr-2" />
                                Choose File
                              </span>
                            </Button>
                          </label>
                          <Button variant="outline" onClick={downloadCSVTemplate}>
                            <Download className="h-4 w-4 mr-2" />
                            Download Template
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {csvData.length} contacts loaded
                            </Badge>
                            <Badge variant="outline" className="text-green-600">
                              {csvData.filter((e) => e.status === 'sent').length} sent
                            </Badge>
                            {csvData.filter((e) => e.status === 'failed').length > 0 && (
                              <Badge variant="destructive">
                                {csvData.filter((e) => e.status === 'failed').length} failed
                              </Badge>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCsvData([])}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Clear
                          </Button>
                        </div>

                        <div className="max-h-80 overflow-y-auto border rounded-lg">
                          <table className="w-full">
                            <thead className="bg-slate-50 sticky top-0">
                              <tr>
                                <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">
                                  Email
                                </th>
                                <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">
                                  Name
                                </th>
                                <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">
                                  Batch
                                </th>
                                <th className="text-center py-2 px-4 text-sm font-medium text-gray-600">
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {csvData.map((entry, index) => (
                                <tr key={index} className="border-t">
                                  <td className="py-2 px-4 text-sm">{entry.email}</td>
                                  <td className="py-2 px-4 text-sm">{entry.name}</td>
                                  <td className="py-2 px-4 text-sm">{entry.batchYear}</td>
                                  <td className="py-2 px-4 text-center">
                                    {getStatusIcon(entry.status)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {isSending && (
                          <div className="space-y-2">
                            <Progress value={sendProgress} />
                            <p className="text-sm text-gray-500 text-center">
                              Sending invitations... {Math.round(sendProgress)}%
                            </p>
                          </div>
                        )}

                        <Button
                          onClick={() => sendInvitations(csvData)}
                          disabled={isSending || csvData.length === 0}
                          className="w-full bg-[#002045] hover:bg-[#003366]"
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Send All Invitations
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Message Template */}
            <Card className="border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-lg">Message Template</CardTitle>
                <CardDescription>Customize the invitation message</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Textarea
                    value={messageTemplate}
                    onChange={(e) => setMessageTemplate(e.target.value)}
                    rows={12}
                    className="text-sm font-mono"
                  />
                  <Alert>
                    <AlertTitle className="text-sm">Available Variables</AlertTitle>
                    <AlertDescription className="text-xs">
                      <code>{'{{name}}'}</code>, <code>{'{{batchYear}}'}</code>,{' '}
                      <code>{'{{inviteLink}}'}</code>, <code>{'{{senderName}}'}</code>
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>

            {/* Tips */}
            <Card className="border-0 shadow-md bg-amber-50">
              <CardHeader>
                <CardTitle className="text-lg text-amber-800">Tips</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-amber-700">
                <p>• Personalize invitations with names for better response rates</p>
                <p>• Include batch year to trigger nostalgia</p>
                <p>• Follow up with non-responders after a week</p>
                <p>• Share your invite link on WhatsApp groups</p>
              </CardContent>
            </Card>

            {/* Stats */}
            <Card className="border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-lg">Your Invite Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-slate-50 rounded-lg">
                    <p className="text-2xl font-bold text-[#002045]">24</p>
                    <p className="text-xs text-gray-500">Invites Sent</p>
                  </div>
                  <div className="text-center p-3 bg-slate-50 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">12</p>
                    <p className="text-xs text-gray-500">Joined</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
