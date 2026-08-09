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

  const [selectedTeam, setSelectedTeam] = useState(null)

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loginOpen, setLoginOpen] = useState(false)
  const [toast, setToast] = useState('')

  const [deletingBid, setDeletingBid] = useState(null)
  const [undoingSale, setUndoingSale] = useState(null)

  const teamMap = useMemo(
    () => Object.fromEntries(teams.map(t => [t.name, t])),
    [teams]
  )

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session)
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

  useEffect(() => {
    loadBase()
  }, [])

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

    const [state, bal, ps, hist, bidData] =
      await Promise.all([
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
          .order('created_at', {
            ascending: false
          }),

        supabase
          .from('auction_results')
          .select('*, player:players(*), team:teams(*)')
          .eq('pool_id', pool.id)
          .order('created_at', {
            ascending: false
          }),

        supabase
          .from('bids')
          .select('*, team:teams(*)')
          .eq('pool_id', pool.id)
          .order('created_at', {
            ascending: false
          })
          .order('id', {
            ascending: false
          })
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

    // Refresh the complete all-pools list as well.
    const { data: completeHistory, error: completeError } =
      await supabase
        .from('auction_results')
        .select(
          '*, player:players(*), team:teams(*), pool:pools(*)'
        )
        .order('created_at', {
          ascending: false
        })

    if (completeError) {
      notify(completeError.message)
    } else {
      setAllHistory(completeHistory || [])
    }
  }

  function notify(msg) {
    setToast(msg)

    setTimeout(() => {
      setToast('')
    }, 3500)
  }

  async function login(email, password) {
    if (!supabase) return

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
  }

  async function startPlayer() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const roll = prompt('Roll number')
    if (!roll) return

    const name = prompt('Player name')
    if (!name) return

    const { error } =
      await supabase.rpc('start_player', {
        p_pool_id: pool.id,
        p_roll_number: roll,
        p_name: name
      })

    if (error) {
      notify(error.message)
    } else {
      notify('Player added')
      await loadPool()
    }
  }

  async function bid(teamName) {
    const team = teamMap[teamName]

    if (!team || !current) return

    const { error } =
      await supabase.rpc('place_bid', {
        p_pool_id: pool.id,
        p_team_id: team.id
      })

    if (error) {
      notify(error.message)
    } else {
      await loadPool()
    }
  }

  async function sold() {
    if (!current?.leader_team_id) {
      notify('Player has no winning team')
      return
    }

    const { error } =
      await supabase.rpc('sell_current_player', {
        p_pool_id: pool.id
      })

    if (error) {
      notify(error.message)
    } else {
      notify('Player SOLD')
      await loadPool()
    }
  }

  async function unsold() {
    if (!current?.current_player_id) {
      notify('No live player')
      return
    }

    const { error } =
      await supabase.rpc('mark_unsold', {
        p_pool_id: pool.id
      })

    if (error) {
      notify(error.message)
    } else {
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
      await supabase.rpc('relist_player', {
        p_player_id: id
      })

    if (error) {
      notify(error.message)
    } else {
      notify('Player brought back at 3 EP')
      await loadPool()
    }
  }

  async function deleteBid(id) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const confirmed = window.confirm(
      'Delete this bid?\n\nOnly this bid will be removed.'
    )

    if (!confirmed) return

    setDeletingBid(id)

    const { error } =
      await supabase.rpc('delete_bid', {
        p_bid_id: id
      })

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

    if (!current?.current_player_id) {
      notify('No live player')
      return
    }

    const playerBids = bids
      .filter(
        b =>
          b.player_id ===
          current.current_player_id
      )
      .sort((a, b) => {
        const difference =
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime()

        if (difference !== 0) {
          return difference
        }

        return Number(a.id) - Number(b.id)
      })

    const lastBid =
      playerBids[playerBids.length - 1]

    if (!lastBid) {
      notify('There are no bids to undo')
      return
    }

    await deleteBid(lastBid.id)
  }

  async function undoSoldPlayer(resultId) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const result = history.find(
      x => x.id === resultId
    )

    if (!result || result.status !== 'SOLD') {
      notify('Only SOLD players can be undone')
      return
    }

    const confirmed = window.confirm(
      `Undo the sale of ${
        result.player?.name || 'this player'
      }?\n\n` +
        `Team: ${
          result.team?.name || 'Unknown'
        }\n` +
        `Refund: ${result.final_price} EP\n\n` +
        `The player will be removed from the squad and returned to available status.`
    )

    if (!confirmed) return

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
      notify(
        `Sale undone • ${result.final_price} EP refunded`
      )
      await loadPool()
    }
  }

  const selectedBalance = name =>
    balances.find(
      x =>
        x.team_id ===
        teamMap[name]?.id
    )?.remaining_ep ?? 150

  const nextBid = b =>
    b < 10
      ? b + 1
      : b < 20
      ? b + 2
      : b + 5

  const currentPlayerBids =
    current?.current_player_id
      ? bids
          .filter(
            b =>
              b.player_id ===
              current.current_player_id
          )
          .sort((a, b) => {
            const difference =
              new Date(
                a.created_at
              ).getTime() -
              new Date(
                b.created_at
              ).getTime()

            if (difference !== 0) {
              return difference
            }

            return (
              Number(a.id) -
              Number(b.id)
            )
          })
      : []

  /*
   * CURRENT POOL TEAM SQUAD
   */
  function currentPoolTeamPlayers(teamName) {
    if (!pool) return []

    return history.filter(
      x =>
        x.status === 'SOLD' &&
        x.team?.name === teamName
    )
  }

  /*
   * ALL POOLS TEAM SQUAD
   */
  function allPoolTeamPlayers(teamName) {
    return allHistory.filter(
      x =>
        x.status === 'SOLD' &&
        x.team?.name === teamName
    )
  }

  function openCurrentPoolTeam(teamName) {
    setSelectedTeam(teamName)
    setPage('teams')
  }

  function openAllPoolsTeam(teamName) {
    setSelectedTeam(teamName)
    setPage('teams')
  }

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
              bidding • Real-time
              Supabase sync
            </div>
          </div>

          <select
            className="select"
            value={pool?.id || ''}
            onChange={e => {
              setSelectedTeam(null)
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
                  ?.roll_number || '—'}
              </div>

              <div className="playername">
                {c?.current_player?.name ||
                  'No Player Added'}
              </div>

              <div className="ep">
                CURRENT BID
              </div>

              <div className="bid">
                {c?.current_bid ?? 3}
                <small> EP</small>
              </div>

              <div
                className={`leader ${
                  TEAM_COLORS[
                    c?.leader_team?.name
                  ] || ''
                }`}
              >
                {c?.leader_team?.name
                  ? `${c.leader_team.name} • ${c.current_bid} EP`
                  : 'OPEN • BASE 3 EP'}
              </div>
            </div>

            {mode === 'admin' && (
              <>
                <div className="controls">
                  {TEAM_NAMES.map(name => (
                    <button
                      className="teamBtn"
                      key={name}
                      disabled={
                        !c?.current_player ||
                        selectedBalance(name) <
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
                  ))}
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
                    onClick={startPlayer}
                    disabled={
                      !!c?.current_player
                    }
                  >
                    NEXT PLAYER
                  </button>
                </div>

                {c?.current_player && (
                  <div
                    className="card"
                    style={{
                      marginTop: '16px'
                    }}
                  >
                    <div className="eyebrow">
                      ADMIN BID CONTROL
                    </div>

                    <div className="teamPool">
                      {c.current_player.name}
                      {' • '}Bid History
                    </div>

                    {currentPlayerBids.length ===
                    0 ? (
                      <div className="notice">
                        No bids yet. Player
                        is open at 3 EP.
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
                                key={b.id}
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
                                    {b.team?.name ||
                                      'Unknown Team'}
                                  </strong>

                                  <div
                                    className="sub"
                                    style={{
                                      marginTop:
                                        '2px'
                                    }}
                                  >
                                    {b.amount} EP
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
                {TEAM_NAMES.map(name => (
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
                ))}
              </div>
            </div>
          </section>
        </div>
      </>
    )
  }

  function teamsPage() {
    /*
     * TEAM SELECTED
     *
     * This view is reached either from:
     * 1. A team card on the current auction pool
     * 2. The Teams main menu
     *
     * When opened from the auction page, the user
     * expects the current pool. When opened from
     * the Teams menu, the user expects all pools.
     *
     * We therefore show a clear toggle.
     */
    if (selectedTeam) {
      const currentPoolPlayers =
        currentPoolTeamPlayers(
          selectedTeam
        )

      const allPlayers =
        allPoolTeamPlayers(
          selectedTeam
        )

      const [viewMode, setViewMode] =
        useState('all')

      const displayedPlayers =
        viewMode === 'current'
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
                {viewMode ===
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
                setSelectedTeam(null)
              }
            >
              ← All Teams
            </button>
          </div>

          <div
            className="actions"
            style={{
              marginBottom: '16px'
            }}
          >
            <button
              className={
                viewMode === 'current'
                  ? 'btn primary'
                  : 'btn'
              }
              onClick={() =>
                setViewMode('current')
              }
            >
              Current Pool
            </button>

            <button
              className={
                viewMode === 'all'
                  ? 'btn primary'
                  : 'btn'
              }
              onClick={() =>
                setViewMode('all')
              }
            >
              All Pools
            </button>
          </div>

          <div className="card">
            <div className="eyebrow">
              {selectedTeam} •{' '}
              {viewMode ===
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
              {displayedPlayers.length}{' '}
              player
              {displayedPlayers.length ===
              1
                ? ''
                : 's'}
            </div>

            {displayedPlayers.length ===
            0 ? (
              <div className="notice">
                No players purchased by{' '}
                {selectedTeam}{' '}
                {viewMode ===
                'current'
                  ? `in ${poolLabel(pool)}`
                  : 'across any pool'}
                .
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    {viewMode ===
                      'all' && (
                      <th>Pool</th>
                    )}

                    <th>Player</th>
                    <th>Price</th>
                  </tr>
                </thead>

                <tbody>
                  {displayedPlayers.map(
                    x => (
                      <tr key={x.id}>
                        {viewMode ===
                          'all' && (
                          <td>
                            {x.pool
                              ? `${x.pool.batch_year} • ${x.pool.gender}`
                              : '—'}
                          </td>
                        )}

                        <td>
                          {x.player
                            ?.roll_number}{' '}
                          —{' '}
                          {x.player?.name}
                        </td>

                        <td>
                          {x.final_price}{' '}
                          EP
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

    /*
     * MAIN TEAMS PAGE
     *
     * Each team is clickable.
     * Clicking it opens ALL POOLS for
     * that team.
     */
    return (
      <>
        <Header
          eyebrow="5 TEAMS"
          title="TEAMS"
          sub="Select a team to view its complete squad across all pools."
        />

        <div className="stats">
          {TEAM_NAMES.map(name => {
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
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <span
                  className={
                    TEAM_COLORS[name]
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
          })}
        </div>
      </>
    )
  }

  function playersPage() {
    return (
      <>
        <Header
          eyebrow="ADMIN"
          title="PLAYERS"
          sub="Roll number + name • Base price 3 EP"
        />

        <div className="card">
          <div className="notice">
            Players are stored in
            Supabase. The selected
            pool is{' '}
            <b>{poolLabel(pool)}</b>.
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Roll</th>
                <th>Name</th>
                <th>Pool</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {players.map(p => (
                <tr key={p.id}>
                  <td>
                    {p.roll_number}
                  </td>

                  <td>{p.name}</td>

                  <td>
                    {poolLabel(pool)}
                  </td>

                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  function historyPage() {
    return (
      <>
        <Header
          eyebrow="COMPLETE LIST"
          title="AUCTION HISTORY"
          sub="Sold and unsold records from Supabase."
        />

        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Result</th>
                <th>Team</th>
                <th>Price</th>
              </tr>
            </thead>

            <tbody>
              {history.map(x => (
                <tr key={x.id}>
                  <td>
                    {x.player
                      ?.roll_number}{' '}
                    —{' '}
                    {x.player?.name}
                  </td>

                  <td>{x.status}</td>

                  <td>
                    {x.team?.name ||
                      '—'}
                  </td>

                  <td>
                    {x.final_price
                      ? `${x.final_price} EP`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  function poolsPage() {
    return (
      <>
        <Header
          eyebrow="10 INDEPENDENT POOLS"
          title="POOLS"
          sub="Each team starts with 150 EP in every pool."
        />

        <div className="stats poolsGrid">
          {pools.map(p => (
            <div
              className="stat"
              key={p.id}
            >
              <span>
                {poolLabel(p)}
              </span>

              <b>5 × 150 EP</b>

              <small>
                Independent team
                budgets
              </small>
            </div>
          ))}
        </div>
      </>
    )
  }

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
                  : setMode('admin')
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
                setLoginOpen(true)
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
                page === 'auction'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('auction')
              }}
            >
              🔴 Live Auction
            </Nav>

            <Nav
              active={
                page === 'players'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('players')
              }}
            >
              👤 Players
            </Nav>

            <Nav
              active={
                page === 'teams'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('teams')
              }}
            >
              🏆 Teams
            </Nav>

            <Nav
              active={
                page === 'history'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('history')
              }}
            >
              📜 Auction History
            </Nav>

            <Nav
              active={
                page === 'pools'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('pools')
              }}
            >
              🗂 Pools
            </Nav>
          </div>
        </aside>

        <main className="content">
          {page === 'auction'
            ? auction()
            : page === 'players'
            ? playersPage()
            : page === 'teams'
            ? teamsPage()
            : page === 'history'
            ? historyPage()
            : poolsPage()}
        </main>
      </div>

      {loginOpen && (
        <Login
          onLogin={login}
          onClose={() =>
            setLoginOpen(false)
          }
        />
      )}

      {toast && (
        <div className="toast">
          {toast}
        </div>
      )}
    </div>
  )
}

function TeamCard({
  name,
  balance,
  onClick
}) {
  return (
    <div
      className="team"
      onClick={onClick}
      style={{
        cursor: 'pointer'
      }}
    >
      <div className="teamtop">
        <span
          className={`teamname ${
            TEAM_COLORS[name]
          }`}
        >
          {name}
        </span>

        <span className="balance">
          {balance} EP
        </span>
      </div>

      <div
        className={`bar ${
          TEAM_COLORS[name]
        }`}
      >
        <i
          style={{
            width: `${Math.max(
              0,
              Math.min(
                100,
                (balance / 150) *
                  100
              )
            )}%`
          }}
        />
      </div>

      <small
        style={{
          display: 'block',
          marginTop: '6px',
          opacity: 0.7
        }}
      >
        Tap to view players →
      </small>
    </div>
  )
}

function Header({
  eyebrow,
  title,
  sub
}) {
  return (
    <div className="sectionhead">
      <div>
        <div className="eyebrow">
          {eyebrow}
        </div>

        <div className="title">
          {title}
        </div>

        <div className="sub">
          {sub}
        </div>
      </div>
    </div>
  )
}

function Nav({
  active,
  onClick,
  children
}) {
  return (
    <button
      className={
        active ? 'active' : ''
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function poolLabel(p) {
  return p
    ? `${p.batch_year} • ${p.gender}`
    : '—'
}

function Login({
  onLogin,
  onClose
}) {
  const [email, setEmail] =
    useState('')

  const [password, setPassword] =
    useState('')

  return (
    <div className="modal">
      <div className="modalCard">
        <div className="title">
          Admin Login
        </div>

        <div className="sub">
          Only authenticated admins
          can run the auction.
        </div>

        <input
          className="field"
          placeholder="Admin email"
          value={email}
          onChange={e =>
            setEmail(
              e.target.value
            )
          }
        />

        <input
          className="field"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e =>
            setPassword(
              e.target.value
            )
          }
        />

        <div className="actions">
          <button
            className="btn"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="btn primary"
            onClick={() =>
              onLogin(
                email,
                password
              )
            }
          >
            Login
          </button>
        </div>
      </div>
    </div>
  )
}

function SetupScreen() {
  return (
    <div className="loading">
      <div className="card setup">
        <div className="title">
          Euphoria is ready for
          Supabase
        </div>

        <p className="sub">
          Add
          VITE_SUPABASE_URL and
          VITE_SUPABASE_ANON_KEY
          to your Vercel
          environment variables,
          run the supplied SQL in
          Supabase, then redeploy.
        </p>
      </div>
    </div>
  )
}

createRoot(
  document.getElementById('root')
).render(<App />)
