import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, supabaseConfigured } from './lib/supabase'
import './styles.css'

const TEAM_COLORS = {
  Falcons: 'blue',
  Eagles: 'yellow',
  Thunderbirds: 'purple',
  Griffins: 'red',
  Phoenix: 'orange'
}

const TEAM_NAMES = Object.keys(TEAM_COLORS)

function App() {
  const [mode, setMode] = useState('public')
  const [page, setPage] = useState('auction')

  const [pool, setPool] = useState(null)
  const [pools, setPools] = useState([])
  const [teams, setTeams] = useState([])

  const [balances, setBalances] = useState([])
  const [current, setCurrent] = useState(null)

  const [players, setPlayers] = useState([])
  const [history, setHistory] = useState([])
  const [allHistory, setAllHistory] = useState([])
  const [bids, setBids] = useState([])

  const [previousPlayer, setPreviousPlayer] = useState(null)

  const [selectedTeam, setSelectedTeam] = useState(null)
  const [teamViewMode, setTeamViewMode] = useState('all')

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loginOpen, setLoginOpen] = useState(false)
  const [toast, setToast] = useState('')

  const [deletingBid, setDeletingBid] = useState(null)
  const [undoingSale, setUndoingSale] = useState(null)
  const [deletingPlayer, setDeletingPlayer] = useState(null)

  const [manualBidOpen, setManualBidOpen] = useState(false)
  const [manualBidTeam, setManualBidTeam] = useState('Falcons')
  const [manualBidAmount, setManualBidAmount] = useState('')

  const [manualSaleOpen, setManualSaleOpen] = useState(false)
  const [manualSaleTeam, setManualSaleTeam] = useState('Falcons')
  const [manualSaleAmount, setManualSaleAmount] = useState('')

  /* =========================================================
     ADMIN ACCESS
  ========================================================= */

  const [isOwner, setIsOwner] = useState(false)
  const [adminUsers, setAdminUsers] = useState([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [newAdminUserId, setNewAdminUserId] = useState('')
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [removingAdmin, setRemovingAdmin] = useState(null)

  const teamMap = useMemo(
    () => Object.fromEntries(teams.map(t => [t.name, t])),
    [teams]
  )

  /* =========================================================
     AUTH
  ========================================================= */

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
      }
    )

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /* =========================================================
     LOAD BASE
  ========================================================= */

  useEffect(() => {
    loadBase()
  }, [])

  /* =========================================================
     LOAD POOL + REALTIME
  ========================================================= */

  useEffect(() => {
    if (!pool || !supabaseConfigured) return

    loadPool()

    const channel = supabase
      .channel(`auction-${pool.id}`)

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_states',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'players',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bids',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'team_pool_balances',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_results',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )

      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [pool?.id])

  /* =========================================================
     CHECK OWNER
  ========================================================= */

  useEffect(() => {
    if (!session || !supabaseConfigured) {
      setIsOwner(false)
      return
    }

    checkOwner()
  }, [session])

  async function checkOwner() {
    const { data, error } = await supabase.rpc('is_owner')

    if (error) {
      setIsOwner(false)
      return
    }

    setIsOwner(Boolean(data))
  }

  /* =========================================================
     LOAD ADMIN USERS
  ========================================================= */

  useEffect(() => {
    if (session && isOwner && page === 'admins') {
      loadAdminUsers()
    }
  }, [session, isOwner, page])

  async function loadAdminUsers() {
    if (!session || !isOwner) return

    setAdminLoading(true)

    const { data, error } = await supabase.rpc(
      'get_admin_users'
    )

    setAdminLoading(false)

    if (error) {
      notify(error.message)
      return
    }

    setAdminUsers(data || [])
  }

  /* =========================================================
     BASE DATA
  ========================================================= */

  async function loadBase() {
    if (!supabaseConfigured) return

    const [p, t, allResults] = await Promise.all([
      supabase
        .from('pools')
        .select('*')
        .order('batch_year')
        .order('gender'),

      supabase
        .from('teams')
        .select('*')
        .order('sort_order'),

      supabase
        .from('auction_results')
        .select('*, player:players(*), team:teams(*), pool:pools(*)')
        .order('created_at', { ascending: false })
    ])

    if (p.error) notify(p.error.message)
    if (t.error) notify(t.error.message)
    if (allResults.error) notify(allResults.error.message)

    setPools(p.data || [])
    setTeams(t.data || [])
    setAllHistory(allResults.data || [])

    if (p.data?.length) {
      setPool(
        prev =>
          prev ||
          p.data.find(
            x =>
              x.batch_year === 2024 &&
              x.gender === 'Male'
          ) ||
          p.data[0]
      )
    }

    setLoading(false)
  }

  async function loadPool() {
    if (!pool) return

    const [
      state,
      bal,
      ps,
      hist,
      bidData
    ] = await Promise.all([
      supabase
        .from('auction_states')
        .select('*, current_player:players(*)')
        .eq('pool_id', pool.id)
        .single(),

      supabase
        .from('team_pool_balances')
        .select('*, team:teams(*)')
        .eq('pool_id', pool.id)
        .order('id'),

      supabase
        .from('players')
        .select('*')
        .eq('pool_id', pool.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('auction_results')
        .select('*, player:players(*), team:teams(*)')
        .eq('pool_id', pool.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('bids')
        .select('*, team:teams(*)')
        .eq('pool_id', pool.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    ])

    if (state.error) notify(state.error.message)
    if (bal.error) notify(bal.error.message)
    if (ps.error) notify(ps.error.message)
    if (hist.error) notify(hist.error.message)
    if (bidData.error) notify(bidData.error.message)

    if (state.data) {
      setCurrent(state.data)
    }

    setBalances(bal.data || [])
    setPlayers(ps.data || [])
    setHistory(hist.data || [])
    setBids(bidData.data || [])

    const currentPlayerId =
      state.data?.current_player_id

    const restoredPrevious =
      (hist.data || []).find(result => {
        const status =
          String(result.status || '').toUpperCase()

        return (
          (status === 'SOLD' ||
            status === 'UNSOLD') &&
          result.player_id !== currentPlayerId
        )
      }) || null

    if (restoredPrevious) {
      setPreviousPlayer(restoredPrevious)
    }

    const {
      data: completeHistory,
      error: completeError
    } = await supabase
      .from('auction_results')
      .select(
        '*, player:players(*), team:teams(*), pool:pools(*)'
      )
      .order('created_at', {
        ascending: false
      })

    if (!completeError) {
      setAllHistory(completeHistory || [])
    }
  }

  function notify(msg) {
    setToast(msg)

    setTimeout(() => {
      setToast('')
    }, 3500)
  }

  /* =========================================================
     AUTH ACTIONS
  ========================================================= */

  async function login(email, password) {
    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      })

    if (error) {
      notify(error.message)
    } else {
      setLoginOpen(false)
      setMode('admin')
    }
  }

  async function logout() {
    await supabase.auth.signOut()

    setMode('public')
    setPage('auction')
    setIsOwner(false)
    setAdminUsers([])
  }

  /* =========================================================
     ADMIN MANAGEMENT
  ========================================================= */

  async function addAdmin() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!isOwner) {
      notify('Owner access required')
      return
    }

    const userId =
      newAdminUserId.trim()

    if (!userId) {
      notify('Enter the Supabase Auth User UUID')
      return
    }

    setAddingAdmin(true)

    const { error } =
      await supabase.rpc(
        'grant_admin_access',
        {
          p_user_id: userId
        }
      )

    setAddingAdmin(false)

    if (error) {
      notify(error.message)
      return
    }

    setNewAdminUserId('')

    notify('Admin access granted ✓')

    await loadAdminUsers()
  }

  async function removeAdmin(userId) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!isOwner) {
      notify('Owner access required')
      return
    }

    if (userId === session.user.id) {
      notify(
        'The owner cannot remove their own access'
      )
      return
    }

    if (
      !window.confirm(
        'Remove admin access from this user?'
      )
    ) {
      return
    }

    setRemovingAdmin(userId)

    const { error } =
      await supabase.rpc(
        'revoke_admin_access',
        {
          p_user_id: userId
        }
      )

    setRemovingAdmin(null)

    if (error) {
      notify(error.message)
      return
    }

    notify('Admin access removed')

    await loadAdminUsers()
  }

  /* =========================================================
     AUCTION FUNCTIONS
  ========================================================= */

  async function startPlayer() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!pool) return

    const roll = prompt('Roll number')
    if (!roll) return

    const name = prompt('Player name')
    if (!name) return

    const { error } =
      await supabase.rpc(
        'start_player',
        {
          p_pool_id: pool.id,
          p_roll_number: roll,
          p_name: name
        }
      )

    if (error) {
      notify(error.message)
    } else {
      notify('Player added')
      await loadPool()
    }
  }

  async function bid(teamName) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const team =
      teamMap[teamName]

    if (
      !team ||
      !current?.current_player_id
    ) {
      return
    }

    const { error } =
      await supabase.rpc(
        'place_bid',
        {
          p_pool_id: pool.id,
          p_team_id: team.id
        }
      )

    if (error) {
      notify(error.message)
    } else {
      await loadPool()
    }
  }

  async function sold() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!current?.leader_team_id) {
      notify(
        'Player has no winning team'
      )
      return
    }

    const playerBeingSold =
      current?.current_player
        ? {
            id:
              current.current_player.id,
            player_id:
              current.current_player.id,
            player:
              current.current_player,
            status: 'SOLD',
            final_price:
              current.current_bid,
            team:
              current.leader_team ||
              null,
            team_id:
              current.leader_team_id,
            created_at:
              new Date().toISOString()
          }
        : null

    const { error } =
      await supabase.rpc(
        'sell_current_player',
        {
          p_pool_id: pool.id
        }
      )

    if (error) {
      notify(error.message)
    } else {
      if (playerBeingSold) {
        setPreviousPlayer(
          playerBeingSold
        )
      }

      notify('Player SOLD')
      await loadPool()
    }
  }

  async function unsold() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!current?.current_player_id) {
      notify('No live player')
      return
    }

    const playerBeingUnsold =
      current?.current_player
        ? {
            id:
              current.current_player.id,
            player_id:
              current.current_player.id,
            player:
              current.current_player,
            status: 'UNSOLD',
            final_price: null,
            team: null,
            team_id: null,
            created_at:
              new Date().toISOString()
          }
        : null

    const { error } =
      await supabase.rpc(
        'mark_unsold',
        {
          p_pool_id: pool.id
        }
      )

    if (error) {
      notify(error.message)
    } else {
      if (playerBeingUnsold) {
        setPreviousPlayer(
          playerBeingUnsold
        )
      }

      notify('Player UNSOLD')
      await loadPool()
    }
  }

  async function relist(id) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const { error } =
      await supabase.rpc(
        'relist_player',
        {
          p_player_id: id
        }
      )

    if (error) {
      notify(error.message)
    } else {
      notify(
        'Player brought back at 3 EP'
      )

      await loadPool()
    }
  }

  async function deleteBid(id) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (
      !window.confirm(
        'Delete this bid?'
      )
    ) {
      return
    }

    setDeletingBid(id)

    const { error } =
      await supabase.rpc(
        'delete_bid',
        {
          p_bid_id: id
        }
      )

    setDeletingBid(null)

    if (error) {
      notify(error.message)
    } else {
      notify('Bid deleted')
      await loadPool()
    }
  }

  async function undoLastBid() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const playerBids =
      bids
        .filter(
          b =>
            b.player_id ===
            current?.current_player_id
        )
        .sort((a, b) => {
          const d =
            new Date(
              a.created_at
            ).getTime() -
            new Date(
              b.created_at
            ).getTime()

          return d !== 0
            ? d
            : Number(a.id) -
              Number(b.id)
        })

    const lastBid =
      playerBids[
        playerBids.length - 1
      ]

    if (!lastBid) {
      notify(
        'There are no bids to undo'
      )
      return
    }

    await deleteBid(lastBid.id)
  }

  async function undoSoldPlayer(
    resultId
  ) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const result =
      history.find(
        x => x.id === resultId
      )

    if (
      !result ||
      String(
        result.status
      ).toUpperCase() !== 'SOLD'
    ) {
      notify(
        'Only SOLD players can be undone'
      )
      return
    }

    if (
      !window.confirm(
        `Undo sale of ${
          result.player?.name ||
          'this player'
        }?\n\n` +
        `Team: ${
          result.team?.name ||
          'Unknown'
        }\n` +
        `Refund: ${
          result.final_price
        } EP`
      )
    ) {
      return
    }

    setUndoingSale(resultId)

    const { error } =
      await supabase.rpc(
        'undo_sold_player',
        {
          p_result_id: resultId
        }
      )

    setUndoingSale(null)

    if (error) {
      notify(error.message)
    } else {
      if (
        previousPlayer?.id ===
        resultId
      ) {
        setPreviousPlayer(null)
      }

      notify(
        `${result.final_price} EP refunded`
      )

      await loadPool()
    }
  }

  async function deletePlayer(
    playerId
  ) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const player =
      players.find(
        p => p.id === playerId
      )

    if (!player) return

    if (
      player.status === 'sold'
    ) {
      notify(
        'Undo the sale before deleting a sold player'
      )
      return
    }

    if (
      !window.confirm(
        `Delete ${player.name}?\n\nThis will permanently remove the player.`
      )
    ) {
      return
    }

    setDeletingPlayer(playerId)

    const { error } =
      await supabase.rpc(
        'delete_player',
        {
          p_player_id: playerId
        }
      )

    setDeletingPlayer(null)

    if (error) {
      notify(error.message)
    } else {
      notify('Player deleted')
      await loadPool()
    }
  }

  /* =========================================================
     MANUAL BID
  ========================================================= */

  async function manualBid() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!current?.current_player_id) {
      notify('No live player')
      return
    }

    const team =
      teamMap[manualBidTeam]

    const amount =
      Number(manualBidAmount)

    if (!team) {
      notify('Select a team')
      return
    }

    if (
      !Number.isFinite(amount) ||
      amount < 3
    ) {
      notify(
        'Enter a valid bid of at least 3 EP'
      )
      return
    }

    const { error } =
      await supabase.rpc(
        'manual_bid',
        {
          p_pool_id: pool.id,
          p_team_id: team.id,
          p_amount: amount
        }
      )

    if (error) {
      notify(error.message)
      return
    }

    setManualBidAmount('')
    setManualBidOpen(false)

    notify(
      `${team.name} bid ${amount} EP`
    )

    await loadPool()
  }

  /* =========================================================
     MANUAL SALE
  ========================================================= */

  async function manualSale() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!current?.current_player_id) {
      notify('No live player')
      return
    }

    const team =
      teamMap[manualSaleTeam]

    const amount =
      Number(manualSaleAmount)

    if (!team) {
      notify('Select a team')
      return
    }

    if (
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      notify(
        'Enter a valid sale price'
      )
      return
    }

    if (
      !window.confirm(
        `Sell ${
          current.current_player?.name ||
          'player'
        } to ${team.name} for ${amount} EP?`
      )
    ) {
      return
    }

    const playerBeingSold =
      current?.current_player
        ? {
            id:
              current.current_player.id,
            player_id:
              current.current_player.id,
            player:
              current.current_player,
            status: 'SOLD',
            final_price: amount,
            team,
            team_id: team.id,
            created_at:
              new Date().toISOString()
          }
        : null

    const { error } =
      await supabase.rpc(
        'manual_sell_current_player',
        {
          p_pool_id: pool.id,
          p_team_id: team.id,
          p_amount: amount
        }
      )

    if (error) {
      notify(error.message)
      return
    }

    if (playerBeingSold) {
      setPreviousPlayer(
        playerBeingSold
      )
    }

    setManualSaleAmount('')
    setManualSaleOpen(false)

    notify(
      `Player sold to ${team.name} for ${amount} EP`
    )

    await loadPool()
  }

  /* =========================================================
     HELPERS
  ========================================================= */

  const selectedBalance = name =>
    balances.find(
      x =>
        x.team_id ===
        teamMap[name]?.id
    )?.remaining_ep ?? 150

  const nextBid = b => {
    if (
      b === 3 &&
      !current?.leader_team_id
    ) {
      return 3
    }

    if (b < 10) return b + 1
    if (b < 20) return b + 2

    return b + 5
  }

  const currentPlayerBids =
    current?.current_player_id
      ? bids
          .filter(
            b =>
              b.player_id ===
              current.current_player_id
          )
          .sort((a, b) => {
            const d =
              new Date(
                a.created_at
              ).getTime() -
              new Date(
                b.created_at
              ).getTime()

            return d !== 0
              ? d
              : Number(a.id) -
                Number(b.id)
          })
      : []

  function currentPoolTeamPlayers(
    teamName
  ) {
    return history.filter(
      x =>
        String(
          x.status || ''
        ).toUpperCase() ===
          'SOLD' &&
        x.team?.name ===
          teamName
    )
  }

  function allPoolTeamPlayers(
    teamName
  ) {
    return allHistory.filter(
      x =>
        String(
          x.status || ''
        ).toUpperCase() ===
          'SOLD' &&
        x.team?.name ===
          teamName
    )
  }

  function openCurrentPoolTeam(
    teamName
  ) {
    setSelectedTeam(teamName)
    setTeamViewMode('current')
    setPage('teams')
  }

  function openAllPoolsTeam(
    teamName
  ) {
    setSelectedTeam(teamName)
    setTeamViewMode('all')
    setPage('teams')
  }

  /* =========================================================
     AUCTION PAGE
  ========================================================= */

  function auction() {
    const c = current

    return (
      <>
        <div className="sectionhead">
          <div>
            <div className="eyebrow">
              {poolLabel(pool)} POOL
            </div>

            <div className="title">
              LIVE AUCTION
            </div>

            <div className="sub">
              No timer • Admin-controlled
              bidding • Real-time Supabase
              sync
            </div>
          </div>

          <select
            className="select"
            value={pool?.id || ''}
            onChange={e => {
              setSelectedTeam(null)
              setPreviousPlayer(null)

              setPool(
                pools.find(
                  x =>
                    x.id ===
                    e.target.value
                )
              )
            }}
          >
            {pools.map(p => (
              <option
                key={p.id}
                value={p.id}
              >
                {poolLabel(p)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid">
          <section>
            <div className="card player">
              <div className="roll">
                ROLL NO.{' '}
                {c?.current_player
                  ?.roll_number ||
                  '—'}
              </div>

              <div className="playername">
                {c?.current_player
                  ?.name ||
                  'No Player Added'}
              </div>

              <div className="ep">
                CURRENT BID
              </div>

              <div className="bid">
                {c?.current_bid ??
                  3}
                <small>
                  {' '}
                  EP
                </small>
              </div>

              <div
                className={`leader ${
                  TEAM_COLORS[
                    c?.leader_team
                      ?.name
                  ] || ''
                }`}
              >
                {c?.leader_team
                  ?.name
                  ? `${c.leader_team.name} • ${c.current_bid} EP`
                  : 'OPEN • BASE 3 EP'}
              </div>
            </div>

            {/* PREVIOUS PLAYER */}

            {previousPlayer && (
              <div
                className="card"
                style={{
                  marginTop: '16px',
                  border:
                    '1px solid rgba(255,255,255,.12)'
                }}
              >
                <div className="eyebrow">
                  PREVIOUS PLAYER
                </div>

                <div
                  style={{
                    marginTop: '8px',
                    fontSize: '22px',
                    fontWeight: '800'
                  }}
                >
                  {previousPlayer
                    .player?.name ||
                    'Unknown Player'}
                </div>

                <div
                  className="sub"
                  style={{
                    marginTop: '4px'
                  }}
                >
                  ROLL NO.{' '}
                  {previousPlayer
                    .player
                    ?.roll_number ||
                    '—'}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems:
                      'center',
                    justifyContent:
                      'space-between',
                    gap: '12px',
                    marginTop:
                      '14px',
                    flexWrap:
                      'wrap'
                  }}
                >
                  <div
                    style={{
                      fontWeight:
                        '800',
                      fontSize:
                        '18px'
                    }}
                  >
                    {String(
                      previousPlayer.status
                    ).toUpperCase() ===
                    'SOLD'
                      ? `🏆 ${
                          previousPlayer
                            .team
                            ?.name ||
                          'Unknown Team'
                        }`
                      : '🔴 UNSOLD'}
                  </div>

                  <div
                    style={{
                      fontWeight:
                        '800',
                      fontSize:
                        '18px'
                    }}
                  >
                    {String(
                      previousPlayer.status
                    ).toUpperCase() ===
                    'SOLD'
                      ? `${
                          previousPlayer
                            .final_price ??
                          0
                        } EP`
                      : '—'}
                  </div>
                </div>

                <div
                  style={{
                    marginTop:
                      '10px',
                    fontSize:
                      '13px',
                    opacity: 0.65
                  }}
                >
                  {String(
                    previousPlayer.status
                  ).toUpperCase() ===
                  'SOLD'
                    ? 'Player sold successfully'
                    : 'Player remained unsold'}
                </div>
              </div>
            )}

            {/* ADMIN CONTROLS */}

            {mode === 'admin' && (
              <>
                <div className="controls">
                  {TEAM_NAMES.map(
                    name => (
                      <button
                        className="teamBtn"
                        key={name}
                        disabled={
                          !c?.current_player ||
                          selectedBalance(
                            name
                          ) <
                            nextBid(
                              c?.current_bid ??
                                3
                            )
                        }
                        onClick={() =>
                          bid(name)
                        }
                      >
                        <span
                          className={
                            TEAM_COLORS[
                              name
                            ]
                          }
                        >
                          {name}
                        </span>

                        <small>
                          Bid{' '}
                          {nextBid(
                            c?.current_bid ??
                              3
                          )}{' '}
                          EP
                        </small>
                      </button>
                    )
                  )}
                </div>

                <div className="actions">
                  <button
                    className="success"
                    onClick={sold}
                    disabled={
                      !c?.current_player ||
                      !c?.leader_team_id
                    }
                  >
                    ✓ SOLD
                  </button>

                  <button
                    className="danger"
                    onClick={unsold}
                    disabled={
                      !c?.current_player
                    }
                  >
                    UNSOLD
                  </button>

                  <button
                    className="primary"
                    onClick={
                      startPlayer
                    }
                    disabled={
                      !!c?.current_player
                    }
                  >
                    NEXT PLAYER
                  </button>
                </div>

                {/* MANUAL CONTROLS */}

                {c?.current_player && (
                  <div
                    className="card"
                    style={{
                      marginTop:
                        '16px'
                    }}
                  >
                    <div className="eyebrow">
                      MANUAL AUCTION
                      CONTROL
                    </div>

                    <div className="sub">
                      Use this if you
                      need to manually
                      correct a bid or
                      sale.
                    </div>

                    <div
                      className="actions"
                      style={{
                        marginTop:
                          '12px'
                      }}
                    >
                      <button
                        className="btn primary"
                        onClick={() => {
                          setManualBidTeam(
                            c?.leader_team
                              ?.name ||
                              'Falcons'
                          )

                          setManualBidAmount(
                            String(
                              c?.current_bid ??
                                3
                            )
                          )

                          setManualBidOpen(
                            true
                          )
                        }}
                      >
                        ➕ Manual Bid
                      </button>

                      <button
                        className="btn success"
                        onClick={() => {
                          setManualSaleTeam(
                            c?.leader_team
                              ?.name ||
                              'Falcons'
                          )

                          setManualSaleAmount(
                            String(
                              c?.current_bid ??
                                3
                            )
                          )

                          setManualSaleOpen(
                            true
                          )
                        }}
                      >
                        💰 Manual Sale
                      </button>
                    </div>
                  </div>
                )}

                {/* BID HISTORY */}

                {c?.current_player && (
                  <div
                    className="card"
                    style={{
                      marginTop:
                        '16px'
                    }}
                  >
                    <div className="eyebrow">
                      ADMIN BID CONTROL
                    </div>

                    <div className="teamPool">
                      {
                        c
                          .current_player
                          .name
                      }{' '}
                      • Bid History
                    </div>

                    {currentPlayerBids.length ===
                    0 ? (
                      <div className="notice">
                        No bids yet.
                        Player is open
                        at 3 EP.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            display:
                              'flex',
                            flexDirection:
                              'column',
                            gap: '8px',
                            marginTop:
                              '12px'
                          }}
                        >
                          {currentPlayerBids.map(
                            b => (
                              <div
                                key={
                                  b.id
                                }
                                style={{
                                  display:
                                    'flex',
                                  justifyContent:
                                    'space-between',
                                  alignItems:
                                    'center',
                                  gap: '10px',
                                  padding:
                                    '10px 12px',
                                  border:
                                    '1px solid rgba(255,255,255,.1)',
                                  borderRadius:
                                    '10px'
                                }}
                              >
                                <div>
                                  <strong>
                                    {b
                                      .team
                                      ?.name ||
                                      'Unknown Team'}
                                  </strong>

                                  <div
                                    className="sub"
                                    style={{
                                      marginTop:
                                        '2px'
                                    }}
                                  >
                                    {
                                      b.amount
                                    }{' '}
                                    EP
                                  </div>
                                </div>

                                <button
                                  className="danger"
                                  disabled={
                                    deletingBid ===
                                    b.id
                                  }
                                  onClick={() =>
                                    deleteBid(
                                      b.id
                                    )
                                  }
                                >
                                  {deletingBid ===
                                  b.id
                                    ? 'Deleting…'
                                    : '🗑 Delete'}
                                </button>
                              </div>
                            )
                          )}
                        </div>

                        <div
                          className="actions"
                          style={{
                            marginTop:
                              '12px'
                          }}
                        >
                          <button
                            className="danger"
                            onClick={
                              undoLastBid
                            }
                            disabled={
                              currentPlayerBids.length ===
                                0 ||
                              deletingBid !==
                                null
                            }
                          >
                            ↩ Undo Last Bid
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            <div className="card">
              <div className="eyebrow">
                TEAM BALANCES
              </div>

              <div className="teamPool">
                {poolLabel(pool)}
              </div>

              <div className="teams">
                {TEAM_NAMES.map(
                  name => (
                    <TeamCard
                      key={name}
                      name={name}
                      balance={selectedBalance(
                        name
                      )}
                      onClick={() =>
                        openCurrentPoolTeam(
                          name
                        )
                      }
                    />
                  )
                )}
              </div>
            </div>
          </section>
        </div>
      </>
    )
  }

  /* =========================================================
     TEAMS PAGE
  ========================================================= */

  function teamsPage() {
    if (selectedTeam) {
      const currentPoolPlayers =
        currentPoolTeamPlayers(
          selectedTeam
        )

      const allPlayers =
        allPoolTeamPlayers(
          selectedTeam
        )

      const displayedPlayers =
        teamViewMode === 'current'
          ? currentPoolPlayers
          : allPlayers

      return (
        <>
          <div className="sectionhead">
            <div>
              <div className="eyebrow">
                TEAM SQUAD
              </div>

              <div className="title">
                {selectedTeam}
              </div>

              <div className="sub">
                {teamViewMode ===
                'current'
                  ? `Players from ${poolLabel(
                      pool
                    )}`
                  : 'Players from all pools'}
              </div>
            </div>

            <button
              className="btn"
              onClick={() =>
                setSelectedTeam(
                  null
                )
              }
            >
              ← All Teams
            </button>
          </div>

          <div
            className="actions"
            style={{
              marginBottom:
                '16px'
            }}
          >
            <button
              className={
                teamViewMode ===
                'current'
                  ? 'btn primary'
                  : 'btn'
              }
              onClick={() =>
                setTeamViewMode(
                  'current'
                )
              }
            >
              Current Pool
            </button>

            <button
              className={
                teamViewMode ===
                'all'
                  ? 'btn primary'
                  : 'btn'
              }
              onClick={() =>
                setTeamViewMode(
                  'all'
                )
              }
            >
              All Pools
            </button>
          </div>

          <div className="card">
            <div className="eyebrow">
              {selectedTeam} •{' '}
              {teamViewMode ===
              'current'
                ? poolLabel(pool)
                : 'ALL POOLS'}
            </div>

            <div
              className="teamPool"
              style={{
                marginBottom:
                  '12px'
              }}
            >
              {
                displayedPlayers.length
              }{' '}
              player
              {displayedPlayers.length ===
              1
                ? ''
                : 's'}
            </div>

            {displayedPlayers.length ===
            0 ? (
              <div className="notice">
                No players purchased
                by {selectedTeam}.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    {teamViewMode ===
                      'all' && (
                      <th>Pool</th>
                    )}

                    <th>Player</th>
                    <th>Price</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {displayedPlayers.map(
                    x => (
                      <tr key={x.id}>
                        {teamViewMode ===
                          'all' && (
                          <td>
                            {x.pool
                              ? `${x.pool.batch_year} • ${x.pool.gender}`
                              : '—'}
                          </td>
                        )}

                        <td>
                          {
                            x.player
                              ?.roll_number
                          }{' '}
                          —{' '}
                          {
                            x.player
                              ?.name
                          }
                        </td>

                        <td>
                          {
                            x.final_price
                          }{' '}
                          EP
                        </td>

                        <td>
                          {x.status}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )
    }

    return (
      <>
        <Header
          eyebrow="5 TEAMS"
          title="TEAMS"
          sub="Select a team to view its complete squad across all pools."
        />

        <div className="stats">
          {TEAM_NAMES.map(
            name => {
              const count =
                allPoolTeamPlayers(
                  name
                ).length

              return (
                <button
                  key={name}
                  className="stat"
                  onClick={() =>
                    openAllPoolsTeam(
                      name
                    )
                  }
                  style={{
                    cursor:
                      'pointer',
                    textAlign:
                      'left'
                  }}
                >
                  <span
                    className={
                      TEAM_COLORS[
                        name
                      ]
                    }
                  >
                    {name}
                  </span>

                  <b>
                    {count} player
                    {count === 1
                      ? ''
                      : 's'}
                  </b>

                  <small>
                    View all pools →
                  </small>
                </button>
              )
            }
          )}
        </div>
      </>
    )
  }

  /* =========================================================
     PLAYERS PAGE
  ========================================================= */

  function playersPage() {
    return (
      <>
        <Header
          eyebrow="ADMIN"
          title="PLAYERS"
          sub="Players in the currently selected pool."
        />

        <div className="card">
          <div className="notice">
            Selected pool:{' '}
            <b>{poolLabel(pool)}</b>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Roll</th>
                <th>Name</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {players.map(
                p => (
                  <tr key={p.id}>
                    <td>
                      {p.roll_number}
                    </td>

                    <td>
                      {p.name}
                    </td>

                    <td>
                      {p.status}
                    </td>

                    <td>
                      <div
                        style={{
                          display:
                            'flex',
                          gap: '6px',
                          flexWrap:
                            'wrap'
                        }}
                      >
                        {p.status ===
                          'unsold' && (
                          <button
                            className="btn primary"
                            onClick={() =>
                              relist(
                                p.id
                              )
                            }
                          >
                            ↻ Relist
                          </button>
                        )}

                        {p.status !==
                          'sold' && (
                          <button
                            className="danger"
                            disabled={
                              deletingPlayer ===
                              p.id
                            }
                            onClick={() =>
                              deletePlayer(
                                p.id
                              )
                            }
                          >
                            {deletingPlayer ===
                            p.id
                              ? 'Deleting…'
                              : '🗑 Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  /* =========================================================
     HISTORY PAGE
  ========================================================= */

  function historyPage() {
    return (
      <>
        <Header
          eyebrow="COMPLETE LIST"
          title="AUCTION HISTORY"
          sub="Sold and unsold records from the selected pool."
        />

        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Result</th>
                <th>Team</th>
                <th>Price</th>

                {mode ===
                  'admin' && (
                  <th>Action</th>
                )}
              </tr>
            </thead>

            <tbody>
              {history.map(
                x => (
                  <tr key={x.id}>
                    <td>
                      {
                        x.player
                          ?.roll_number
                      }{' '}
                      —{' '}
                      {
                        x.player?.name
                      }
                    </td>

                    <td>
                      {x.status}
                    </td>

                    <td>
                      {x.team?.name ||
                        '—'}
                    </td>

                    <td>
                      {x.final_price
                        ? `${x.final_price} EP`
                        : '—'}
                    </td>

                    {mode ===
                      'admin' && (
                      <td>
                        {String(
                          x.status
                        ).toUpperCase() ===
                          'SOLD' && (
                          <button
                            className="danger"
                            disabled={
                              undoingSale ===
                              x.id
                            }
                            onClick={() =>
                              undoSoldPlayer(
                                x.id
                              )
                            }
                          >
                            {undoingSale ===
                            x.id
                              ? 'Undoing…'
                              : '↩ Undo Sale'}
                          </button>
                        )}

                        {String(
                          x.status
                        ).toUpperCase() ===
                          'UNSOLD' && (
                          <button
                            className="btn primary"
                            onClick={() =>
                              relist(
                                x.player_id
                              )
                            }
                          >
                            ↻ Relist
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  /* =========================================================
     POOLS PAGE
  ========================================================= */

  function poolsPage() {
    return (
      <>
        <Header
          eyebrow="10 INDEPENDENT POOLS"
          title="POOLS"
          sub="Each team starts with 150 EP in every pool."
        />

        <div className="stats poolsGrid">
          {pools.map(
            p => (
              <div
                className="stat"
                key={p.id}
              >
                <span>
                  {poolLabel(p)}
                </span>

                <b>
                  5 × 150 EP
                </b>

                <small>
                  Independent team
                  budgets
                </small>
              </div>
            )
          )}
        </div>
      </>
    )
  }

  /* =========================================================
     ADMIN PAGE
  ========================================================= */

  function adminsPage() {
    if (!isOwner) {
      return (
        <>
          <Header
            eyebrow="ADMIN ACCESS"
            title="ACCESS DENIED"
            sub="Only the owner can manage administrator access."
          />

          <div className="card">
            <div className="notice">
              👑 Owner access is required
              to manage admins.
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <Header
          eyebrow="OWNER"
          title="ADMIN ACCESS"
          sub="Give or remove access to people who will operate the auction."
        />

        <div className="card">
          <div className="eyebrow">
            ADD ADMIN
          </div>

          <div
            className="sub"
            style={{
              marginTop: '6px'
            }}
          >
            Enter the Supabase Auth User
            UUID of the person you want
            to make an admin.
          </div>

          <input
            className="field"
            style={{
              marginTop: '14px'
            }}
            placeholder="User UUID"
            value={newAdminUserId}
            onChange={e =>
              setNewAdminUserId(
                e.target.value
              )
            }
          />

          <button
            className="btn primary"
            style={{
              marginTop: '10px'
            }}
            disabled={addingAdmin}
            onClick={addAdmin}
          >
            {addingAdmin
              ? 'Adding…'
              : '➕ Give Admin Access'}
          </button>
        </div>

        <div
          className="card"
          style={{
            marginTop: '16px'
          }}
        >
          <div className="eyebrow">
            CURRENT ACCESS
          </div>

          <div
            className="sub"
            style={{
              marginTop: '6px'
            }}
          >
            People currently allowed to
            operate the auction.
          </div>

          {adminLoading ? (
            <div
              className="notice"
              style={{
                marginTop: '14px'
              }}
            >
              Loading access list…
            </div>
          ) : adminUsers.length ===
            0 ? (
            <div
              className="notice"
              style={{
                marginTop: '14px'
              }}
            >
              No admin users found.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection:
                  'column',
                gap: '10px',
                marginTop: '14px'
              }}
            >
              {adminUsers.map(
                admin => {
                  const owner =
                    admin.role ===
                    'owner'

                  return (
                    <div
                      key={
                        admin.user_id
                      }
                      style={{
                        display:
                          'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'space-between',
                        gap: '12px',
                        padding:
                          '14px',
                        border:
                          '1px solid rgba(255,255,255,.1)',
                        borderRadius:
                          '12px',
                        flexWrap:
                          'wrap'
                      }}
                    >
                      <div
                        style={{
                          minWidth: 0,
                          flex: 1
                        }}
                      >
                        <div
                          style={{
                            fontWeight:
                              '800'
                          }}
                        >
                          {owner
                            ? '👑 Owner'
                            : '🛡 Admin'}
                        </div>

                        <div
                          className="sub"
                          style={{
                            marginTop:
                              '4px',
                            wordBreak:
                              'break-all'
                          }}
                        >
                          {admin.user_id}
                        </div>

                        <div
                          style={{
                            fontSize:
                              '12px',
                            opacity:
                              0.55,
                            marginTop:
                              '4px'
                          }}
                        >
                          Added{' '}
                          {new Date(
                            admin.created_at
                          ).toLocaleString()}
                        </div>
                      </div>

                      {!owner && (
                        <button
                          className="danger"
                          disabled={
                            removingAdmin ===
                            admin.user_id
                          }
                          onClick={() =>
                            removeAdmin(
                              admin.user_id
                            )
                          }
                        >
                          {removingAdmin ===
                          admin.user_id
                            ? 'Removing…'
                            : '🗑 Remove'}
                        </button>
                      )}
                    </div>
                  )
                }
              )}
            </div>
          )}
        </div>

        <div
          className="card"
          style={{
            marginTop: '16px'
          }}
        >
          <div className="eyebrow">
            HOW TO ADD SOMEONE
          </div>

          <div
            className="sub"
            style={{
              marginTop: '8px',
              lineHeight: 1.7
            }}
          >
            1. The person must first have
            an account in Supabase
            Authentication → Users.
            <br />
            2. Copy their User UUID.
            <br />
            3. Paste the UUID above.
            <br />
            4. Tap{' '}
            <b>
              Give Admin Access
            </b>
            .
            <br />
            5. They can now log into
            Euphoria and operate the
            auction.
          </div>
        </div>
      </>
    )
  }

  /* =========================================================
     LOADING / SETUP
  ========================================================= */

  if (loading) {
    return (
      <div className="loading">
        Loading Euphoria…
      </div>
    )
  }

  if (!supabaseConfigured) {
    return <SetupScreen />
  }

  /* =========================================================
     MAIN UI
  ========================================================= */

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          EUPHORIA
          <span> AUCTION</span>
        </div>

        <div className="topright">
          <div className="pill">
            {mode.toUpperCase()} VIEW
          </div>

          {session ? (
            <button
              className="btn"
              onClick={() =>
                mode === 'admin'
                  ? logout()
                  : setMode(
                      'admin'
                    )
              }
            >
              {mode === 'admin'
                ? 'Logout'
                : 'Admin'}
            </button>
          ) : (
            <button
              className="btn"
              onClick={() =>
                setLoginOpen(
                  true
                )
              }
            >
              Admin
            </button>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="side">
          <div className="nav">
            <Nav
              active={
                page ===
                'auction'
              }
              onClick={() => {
                setSelectedTeam(
                  null
                )
                setPage(
                  'auction'
                )
              }}
            >
              🔴 Live Auction
            </Nav>

            <Nav
              active={
                page ===
                'players'
              }
              onClick={() => {
                setSelectedTeam(
                  null
                )
                setPage(
                  'players'
                )
              }}
            >
              👤 Players
            </Nav>

            <Nav
              active={
                page === 'teams'
              }
              onClick={() => {
                setSelectedTeam(
                  null
                )
                setPage(
                  'teams'
                )
              }}
            >
              🏆 Teams
            </Nav>

            <Nav
              active={
                page ===
                'history'
              }
              onClick={() => {
                setSelectedTeam(
                  null
                )
                setPage(
                  'history'
                )
              }}
            >
              📜 Auction History
            </Nav>

            <Nav
              active={
                page === 'pools'
              }
              onClick={() => {
                setSelectedTeam(
                  null
                )
                setPage(
                  'pools'
                )
              }}
            >
              🗂 Pools
            </Nav>

            {/* OWNER ONLY */}

            {session &&
              isOwner && (
                <Nav
                  active={
                    page ===
                    'admins'
                  }
                  onClick={() => {
                    setSelectedTeam(
                      null
                    )
                    setPage(
                      'admins'
                    )
                  }}
                >
                  👑 Admin Access
                </Nav>
              )}
          </div>
        </aside>

        <main className="content">
          {page ===
          'auction'
            ? auction()
            : page ===
              'players'
            ? playersPage()
            : page === 'teams'
            ? teamsPage()
            : page ===
              'history'
            ? historyPage()
            : page === 'pools'
            ? poolsPage()
            : adminsPage()}
        </main>
      </div>

      {/* =====================================================
          MANUAL BID MODAL
      ===================================================== */}

      {manualBidOpen && (
        <div className="modal">
          <div className="modalCard">
            <div className="title">
              Manual Bid
            </div>

            <div className="sub">
              Enter the team and
              exact bid amount.
            </div>

            <select
              className="field"
              value={
                manualBidTeam
              }
              onChange={e =>
                setManualBidTeam(
                  e.target.value
                )
              }
            >
              {TEAM_NAMES.map(
                name => (
                  <option
                    key={name}
                    value={name}
                  >
                    {name}
                  </option>
                )
              )}
            </select>

            <input
              className="field"
              type="number"
              min="3"
              placeholder="Bid amount"
              value={
                manualBidAmount
              }
              onChange={e =>
                setManualBidAmount(
                  e.target.value
                )
              }
            />

            <div className="actions">
              <button
                className="btn"
                onClick={() =>
                  setManual
