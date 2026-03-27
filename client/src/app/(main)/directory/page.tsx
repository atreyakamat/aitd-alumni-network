'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Filter,
  MapPin,
  Briefcase,
  GraduationCap,
  Users,
  Grid3X3,
  List,
} from 'lucide-react';
import { getInitials } from '@/lib/utils';

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

// Mock data
const alumni = [
  {
    id: '1',
    fullName: 'Priya Sharma',
    avatarUrl: null,
    headline: 'Senior Software Engineer at Google',
    batchYear: 2018,
    department: 'Computer Science',
    currentCity: 'Bangalore',
    currentCountry: 'India',
    skills: ['React', 'Node.js', 'Python'],
    connectionStatus: null,
  },
  {
    id: '2',
    fullName: 'Rahul Patel',
    avatarUrl: null,
    headline: 'Product Manager at Microsoft',
    batchYear: 2017,
    department: 'Information Technology',
    currentCity: 'Hyderabad',
    currentCountry: 'India',
    skills: ['Product Strategy', 'Agile', 'Data Analysis'],
    connectionStatus: 'connected',
  },
  {
    id: '3',
    fullName: 'Anita Desai',
    avatarUrl: null,
    headline: 'Data Scientist at Amazon',
    batchYear: 2019,
    department: 'Computer Science',
    currentCity: 'Seattle',
    currentCountry: 'USA',
    skills: ['Machine Learning', 'Python', 'SQL'],
    connectionStatus: 'pending',
  },
  // Add more mock alumni...
];

export default function DirectoryPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('All Departments');
  const [selectedYear, setSelectedYear] = useState('All Years');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const filteredAlumni = alumni.filter((person) => {
    const matchesSearch =
      person.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      person.headline?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDepartment =
      selectedDepartment === 'All Departments' || person.department === selectedDepartment;
    const matchesYear =
      selectedYear === 'All Years' || person.batchYear === parseInt(selectedYear);
    return matchesSearch && matchesDepartment && matchesYear;
  });

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
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, company, skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
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
            <Select value={selectedYear} onValueChange={setSelectedYear}>
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
            <Button variant="outline">
              <Filter className="h-4 w-4 mr-2" />
              More Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Count */}
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {filteredAlumni.length} alumni found
        </span>
      </div>

      {/* Alumni Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredAlumni.map((person) => (
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
                    {person.headline}
                  </p>
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <GraduationCap className="h-3 w-3" />
                    <span>{person.department} • {person.batchYear}</span>
                  </div>
                  {person.currentCity && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span>{person.currentCity}, {person.currentCountry}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-3 justify-center">
                    {person.skills.slice(0, 2).map((skill) => (
                      <Badge key={skill} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                    {person.skills.length > 2 && (
                      <Badge variant="secondary" className="text-xs">
                        +{person.skills.length - 2}
                      </Badge>
                    )}
                  </div>
                  <Button
                    className="w-full mt-4"
                    variant={person.connectionStatus === 'connected' ? 'secondary' : 'default'}
                    size="sm"
                  >
                    {person.connectionStatus === 'connected'
                      ? 'Connected'
                      : person.connectionStatus === 'pending'
                      ? 'Pending'
                      : 'Connect'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAlumni.map((person) => (
            <Card key={person.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={person.avatarUrl || undefined} alt={person.fullName} />
                    <AvatarFallback className="text-lg">
                      {getInitials(person.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{person.fullName}</h3>
                    <p className="text-sm text-muted-foreground">{person.headline}</p>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <GraduationCap className="h-3 w-3" />
                        <span>{person.department} • {person.batchYear}</span>
                      </div>
                      {person.currentCity && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span>{person.currentCity}, {person.currentCountry}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {person.skills.map((skill) => (
                        <Badge key={skill} variant="secondary" className="text-xs">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant={person.connectionStatus === 'connected' ? 'secondary' : 'default'}
                    size="sm"
                  >
                    {person.connectionStatus === 'connected'
                      ? 'Connected'
                      : person.connectionStatus === 'pending'
                      ? 'Pending'
                      : 'Connect'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
