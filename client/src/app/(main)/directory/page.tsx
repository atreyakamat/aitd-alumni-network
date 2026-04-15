'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { userApi, networkApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  MapPin,
  GraduationCap,
  Users,
  Grid3X3,
  List,
  AlertCircle,
  Loader2,
  UserPlus,
  Send,
} from 'lucide-react';
import { getInitials } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/context/auth-context';
import Link from 'next/link';

const departments = [
  'All Departments',
  'Computer Science',
  'Information Technology',
  'Electronics',
  'Electrical',
  'Mechanical',
  'Civil',
];

const currentYear = new Date().getFullYear();
const batchYears = ['All Years', ...Array.from({ length: 30 }, (_, i) => String(currentYear - i))];

export default function DirectoryPage() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('All Departments');
  const [selectedYear, setSelectedYear] = useState('All Years');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, string>>({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['directory', searchQuery, selectedDepartment, selectedYear, page],
    queryFn: async () => {
      const params: any = {
        page,
        limit: 12,
        search: searchQuery || undefined,
        batchYear: selectedYear !== 'All Years' ? parseInt(selectedYear) : undefined,
        department: selectedDepartment !== 'All Departments' ? selectedDepartment : undefined,
      };
      const response = await userApi.getDirectory(params);
      return response.data;
    },
    enabled: !!user,
  });

  const { data: connectionsData } = useQuery({
    queryKey: ['connections'],
    queryFn: async () => {
      const response = await networkApi.getConnections(1, 200);
      return response.data;
    },
    enabled: !!user,
  });

  const alumni = data?.data?.items || [];
  const pagination = data?.data || { total: 0, pages: 0, page: 1 };
  const connections = connectionsData?.data?.items || [];

  useEffect(() => {
    if (!user || !connections.length) return;
    const statuses: Record<string, string> = {};
    connections.forEach((conn: any) => {
      const otherUserId = conn.requesterId === user.id ? conn.addresseeId : conn.requesterId;
      statuses[otherUserId] = conn.status;
    });
    setConnectionStatuses(statuses);
  }, [user, connections]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    refetch();
  };

  const handleConnect = async (targetUserId: string) => {
    if (!user || connectingId) return;
    setConnectingId(targetUserId);
    try {
      await networkApi.sendRequest(targetUserId);
      setConnectionStatuses(prev => ({ ...prev, [targetUserId]: 'PENDING' }));
    } catch (error) {
      console.error('Error sending connection request:', error);
    } finally {
      setConnectingId(null);
    }
  };

  const getConnectionStatus = (personId: string) => {
    if (personId === user?.id) return null;
    return connectionStatuses[personId] || null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Alumni Directory</h1>
          <p className="text-muted-foreground">Find and connect with fellow alumni</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setViewMode('grid')}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, company, skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select 
              value={selectedDepartment} 
              onValueChange={(val) => {
                setSelectedDepartment(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select 
              value={selectedYear} 
              onValueChange={(val) => {
                setSelectedYear(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full md:w-[150px]">
                <SelectValue placeholder="Batch Year" />
              </SelectTrigger>
              <SelectContent>
                {batchYears.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit">Search</Button>
          </form>
        </CardContent>
      </Card>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {isLoading ? 'Searching...' : `${pagination.total} alumni found`}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {(error as any)?.response?.data?.error || 'Failed to load alumni directory. Please try again later.'}
          </AlertDescription>
        </Alert>
      ) : alumni.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-20" />
          <h3 className="text-lg font-medium">No alumni found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
        </div>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {alumni.map((person: any) => (
                <Card key={person.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center text-center">
                      <Avatar className="h-20 w-20 mb-3">
                        <AvatarImage src={person.avatarUrl || undefined} alt={person.fullName} />
                        <AvatarFallback className="text-xl">
                          {getInitials(person.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <h3 className="font-semibold">{person.fullName}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {person.headline || 'No headline'}
                      </p>
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <GraduationCap className="h-3 w-3" />
                        <span>{person.department} • {person.batchYear}</span>
                      </div>
                      {(person.locationCity || person.locationCountry) && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          <span>
                            {[person.locationCity, person.locationCountry].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-3 justify-center">
                        {(person.skills || []).slice(0, 2).map((skill: string) => (
                          <Badge key={skill} variant="secondary" className="text-xs">
                            {skill}
                          </Badge>
                        ))}
                        {(person.skills || []).length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{(person.skills || []).length - 2}
                          </Badge>
                        )}
                      </div>
                      <Button
                        className="w-full mt-4"
                        variant={getConnectionStatus(person.id) === 'CONNECTED' ? 'secondary' : 'default'}
                        size="sm"
                        onClick={() => handleConnect(person.id)}
                        disabled={connectingId === person.id || !!getConnectionStatus(person.id)}
                      >
                        {connectingId === person.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : getConnectionStatus(person.id) === 'CONNECTED' ? (
                          'Connected'
                        ) : getConnectionStatus(person.id) === 'PENDING' ? (
                          'Pending'
                        ) : (
                          <>
                            <UserPlus className="h-4 w-4 mr-2" />
                            Connect
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {alumni.map((person: any) => (
                <Card key={person.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="py-4">
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={person.avatarUrl || undefined} alt={person.fullName} />
                        <AvatarFallback className="text-lg">
                          {getInitials(person.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">{person.fullName}</h3>
                        <p className="text-sm text-muted-foreground">{person.headline || 'No headline'}</p>
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <GraduationCap className="h-3 w-3" />
                            <span>{person.department} • {person.batchYear}</span>
                          </div>
                          {(person.locationCity || person.locationCountry) && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              <span>
                                {[person.locationCity, person.locationCountry].filter(Boolean).join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2 justify-center sm:justify-start">
                          {(person.skills || []).map((skill: string) => (
                            <Badge key={skill} variant="secondary" className="text-xs">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Button
                        variant={getConnectionStatus(person.id) === 'CONNECTED' ? 'secondary' : 'default'}
                        size="sm"
                        className="w-full sm:w-auto mt-2 sm:mt-0"
                        onClick={() => handleConnect(person.id)}
                        disabled={connectingId === person.id || !!getConnectionStatus(person.id)}
                      >
                        {connectingId === person.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : getConnectionStatus(person.id) === 'CONNECTED' ? (
                          'Connected'
                        ) : getConnectionStatus(person.id) === 'PENDING' ? (
                          'Pending'
                        ) : (
                          <>
                            <UserPlus className="h-4 w-4 mr-2" />
                            Connect
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <div className="flex items-center px-4 text-sm font-medium">
                Page {page} of {pagination.pages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
