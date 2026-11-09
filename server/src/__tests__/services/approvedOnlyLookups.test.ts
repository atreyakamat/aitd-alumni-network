/**
 * A registration that has not been approved is not a member yet. Nobody lists it (isVerified is false), and the places
 * that look a person up by id treat it as if it did not exist, so a member who somehow holds the id cannot message,
 * connect with, follow, ask for a referral from, or read the profile of somebody who is still waiting for approval.
 */
import { prismaMock } from '../../../tests/helpers';
import { messageService } from '../../services/messageService';
import { networkService } from '../../services/networkService';
import { followService } from '../../services/followService';
import { referralService } from '../../services/referralService';
import { userService } from '../../services/userService';

const ID = '00000000-0000-4000-8000-0000000000aa';
const VIEWER = { id: '00000000-0000-4000-8000-000000000001' };

beforeEach(() => {
  jest.clearAllMocks();
  // The database finds nobody who matches "approved": that is what an unapproved id looks like through the filter
  prismaMock.user.findUnique.mockResolvedValue(null);
});

const askedForApprovedOnly = () => {
  const calls = prismaMock.user.findUnique.mock.calls.map((c: any[]) => c[0].where);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((where: any) => where.approvalStatus === 'APPROVED')).toBe(true);
};

describe('looking a person up by id', () => {
  it('messages: the recipient must be approved', async () => {
    await expect(messageService.sendMessage(VIEWER.id, ID, { content: 'hello' } as never)).rejects.toMatchObject({ statusCode: 404 });
    askedForApprovedOnly();
  });

  it('connection requests: the other person must be approved', async () => {
    await expect(networkService.sendConnectionRequest(VIEWER.id, ID)).rejects.toMatchObject({ statusCode: 404 });
    askedForApprovedOnly();
  });

  it('follow: the target must be approved', async () => {
    await expect(followService.follow(VIEWER as never, ID)).rejects.toMatchObject({ statusCode: 404 });
    askedForApprovedOnly();
  });

  it('follower and following lists: the person must be approved', async () => {
    await expect(followService.listFollowers(VIEWER as never, ID, {})).rejects.toMatchObject({ statusCode: 404 });
    askedForApprovedOnly();
  });

  it('referral requests: the member asked must be approved', async () => {
    await expect(referralService.createRequest(VIEWER.id, { targetId: ID, company: 'Acme', message: 'hi' })).rejects.toMatchObject({ statusCode: 404 });
    askedForApprovedOnly();
  });

  it('profiles: an unapproved registration has no profile page', async () => {
    await expect(userService.getProfile(ID, VIEWER.id)).rejects.toMatchObject({ statusCode: 404 });
    askedForApprovedOnly();
  });
});
